import { GraphEdge, GraphNode, LangGraphAbstraction } from "../types.ts";
import { PluginInfo, WorkflowSkeleton, normalizePluginName } from "./topology-compiler.ts";

export interface NormalizedSkeleton {
  startNode: GraphNode;
  endNode: GraphNode;
  intermediateNodes: GraphNode[];
  nodeDescriptions: Map<string, string>;
  rawEdges: GraphEdge[];
}

/**
 * Normalizes a raw Phase 1 skeleton into real graph nodes/edges: injects the
 * native start/end nodes, filters out any dummy start/end aliases the LLM
 * may have hallucinated, cleans/dedupes node IDs, applies the deterministic
 * node-type reclassification invariants (an "llm" node is never a plugin,
 * agentic tool-use is never a raw plugin call, etc.), and maps skeleton
 * edges onto the cleaned node IDs — pushing the start/intermediate/end nodes
 * directly onto `graph.nodes` as it goes, exactly as the pre-refactor code
 * did inline.
 */
export function normalizeSkeletonToGraph(
  skeleton: WorkflowSkeleton,
  graph: LangGraphAbstraction,
  availablePlugins: PluginInfo[],
  prompt: string,
): NormalizedSkeleton {
  const pluginNames = new Set(availablePlugins.map((p) => p.name));

  // 1. Deterministically inject native Start node via code
  const startNode: GraphNode = {
    id: "start",
    name: "Start",
    type: "start",
    config: {},
  };
  graph.nodes.push(startNode);

  // 2. Deterministically filter out any dummy "start" or "end" nodes
  const bypassMap = new Map<string, string>(); // dummyNodeId -> realTarget
  const skeletonNodesToKeep: typeof skeleton.nodes = [];

  for (const n of skeleton.nodes) {
    const lowerId = n.id.toLowerCase().trim();
    const lowerName = n.name.toLowerCase().trim();
    const isStartAlias =
      lowerId === "start" ||
      lowerId === "start_step" ||
      lowerId === "start_node" ||
      lowerName === "start";
    const isEndAlias =
      lowerId === "end" ||
      lowerId === "end_step" ||
      lowerId === "end_node" ||
      lowerName === "end";

    if (isStartAlias) {
      const outgoing = skeleton.edges.find((e) => e.source === n.id);
      if (outgoing) {
        bypassMap.set(n.id, outgoing.target);
      }
    } else if (isEndAlias) {
      bypassMap.set(n.id, "end");
    } else {
      skeletonNodesToKeep.push(n);
    }
  }

  // Build & Clean Intermediate Nodes
  const idMap = new Map<string, string>();
  idMap.set("start", "start");
  idMap.set("end", "end");

  const intermediateNodes: GraphNode[] = [];
  const nodeDescriptions = new Map<string, string>();
  for (const n of skeletonNodesToKeep) {
    let cleanId = n.id.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (
      cleanId === "start" ||
      cleanId === "end" ||
      graph.nodes.some((x) => x.id === cleanId) ||
      intermediateNodes.some((x) => x.id === cleanId)
    ) {
      cleanId = `${cleanId}_step`;
    }
    idMap.set(n.id, cleanId);
    nodeDescriptions.set(cleanId, n.description);

    let nodeType = n.type;
    let cleanPluginId = normalizePluginName(n.pluginId, availablePlugins);

    // INVARIANT: An LLM node is NEVER a plugin!
    // If a node was marked as 'plugin' but refers to LLM/reasoning or an unknown non-plugin, reclassify as 'llm'!
    if (
      nodeType === "plugin" &&
      (!cleanPluginId || !pluginNames.has(cleanPluginId)) &&
      (/llm|reason|summar|analyz|draft|generat/i.test(cleanId) ||
       /llm|reason|summar|analyz|draft|generat/i.test(n.name) ||
       /llm/i.test(n.pluginId || "") ||
       /llm|reason|summar|analyz|draft|generat/i.test(n.description || ""))
    ) {
      nodeType = "llm";
      cleanPluginId = undefined;
    }

    // INVARIANT: A node that names a REAL registered plugin (by pluginId, or by
    // name/description explicitly mentioning it) needs that plugin invoked to do its
    // job — a pure "llm" node has no tool access, so it can never satisfy this on its
    // own. Reclassify deterministically instead of trusting the LLM's own type choice.
    let seedPlugins: string[] | undefined;
    if (nodeType === "llm") {
      const explicitPluginMatch =
        normalizePluginName(n.pluginId, availablePlugins) ||
        (() => {
          const nodeText = `${n.name} ${n.description || ""}`.toLowerCase();
          return availablePlugins.find((p) => {
            const pNameNorm = p.name.toLowerCase().replace(/[-_]/g, "");
            return nodeText.includes(p.name.toLowerCase()) || nodeText.includes(pNameNorm);
          })?.name;
        })();

      if (explicitPluginMatch) {
        // A single deterministic tool call with no dynamic dependency on this
        // node's own output -> "plugin". Multiple/iterative tool use implied by
        // the description -> "llm" node equipped with that tool (agent behavior).
        // Default to keeping it as an agent-equipped "llm" (safer: it can still
        // make exactly one tool call) unless the description clearly reads as
        // one static call.
        const soundsIterativeOrMultiStep =
          /\b(each|every|multiple|then\s+\w+\s+(read|fetch|extract)|loop|iterat|retry|cross[- ]?reference)\b/i.test(
            n.description || "",
          );
        if (soundsIterativeOrMultiStep) {
          seedPlugins = [explicitPluginMatch];
        } else {
          nodeType = "plugin";
          cleanPluginId = explicitPluginMatch;
        }
      }
    }

    // INVARIANT: A "plugin" node whose own description reads as agentic work —
    // it's explicitly called an "agent"/"agente", or it pairs a tool with a
    // cognitive-synthesis verb (draft/write/summarize/compose/synthesize) — is
    // NEVER a raw mechanical tool call. A plugin like "web_search" only returns
    // raw snippets; it cannot itself "draft" or "write" coherent prose. Force
    // it to an agent-equipped "llm" node instead of trusting the LLM's own
    // "plugin" type choice, which repeatedly under-classifies these steps.
    if (nodeType === "plugin" && cleanPluginId && pluginNames.has(cleanPluginId)) {
      const nodeText = `${n.name} ${n.description || ""}`.toLowerCase();
      const namesAgentExplicitly = /\bagents?\b|\bagentes?\b/.test(nodeText);
      // "write"/"escribir" is ambiguous (creative prose vs. a mechanical file
      // save via file_ops) — a file-writing plugin already legitimately uses
      // that verb, so it's excluded here; only the unambiguous synthesis verbs
      // trigger this check.
      const pairsToolWithSynthesisVerb =
        cleanPluginId !== "file_ops" &&
        /\b(draft|redact|summar|resum|compose|compon|synthesiz|sintetiz)\w*\b/i.test(nodeText);
      if (namesAgentExplicitly || pairsToolWithSynthesisVerb) {
        seedPlugins = [cleanPluginId];
        nodeType = "llm";
        cleanPluginId = undefined;
      }
    }

    if (nodeType === "plugin") {
      if (!cleanPluginId || !pluginNames.has(cleanPluginId)) {
        // Dynamically find the best matching available plugin using description keyword scoring
        const nodeText = `${cleanId} ${n.name} ${n.description || ""} ${prompt}`.toLowerCase();
        let bestMatch: PluginInfo | undefined;
        let highestScore = -1;

        for (const p of availablePlugins) {
          let score = 0;
          const pNameNorm = p.name.toLowerCase().replace(/[-_]/g, "");
          if (nodeText.includes(pNameNorm) || nodeText.includes(p.name.toLowerCase())) {
            score += 10;
          }
          // Score by words in the plugin's own description and parameter names
          const keywords = `${p.name} ${p.description} ${p.parametersDescription || ""}`
            .toLowerCase()
            .split(/[^a-z0-9_]+/)
            .filter((w) => w.length > 3 && !["this", "with", "from", "that", "tool", "plugin", "node", "when"].includes(w));

          for (const kw of keywords) {
            if (nodeText.includes(kw)) {
              score += 1;
            }
          }

          if (score > highestScore) {
            highestScore = score;
            bestMatch = p;
          }
        }

        cleanPluginId = bestMatch?.name || availablePlugins[0]?.name;
      }

      // Deterministic tool-adequacy check: if the user's objective needs file/page
      // CONTENT and the selected plugin's own description explicitly disclaims that
      // capability (e.g. "matches by name only, not content"), it cannot literally
      // satisfy this node — reassign to the best-scoring plugin that doesn't disclaim it.
      const objectiveWantsContent = /\b(content|text|contain|contenga|contenido|palabra|line|línea)\b/i.test(
        prompt,
      );
      const selectedPlugin = availablePlugins.find((p) => p.name === cleanPluginId);
      const selectedDisclaimsContent =
        selectedPlugin &&
        /\b(not|cannot|does not|no)\b[^.]*\bcontent\b|\bcontent\b[^.]*\b(not|cannot|does not)\b/i.test(
          `${selectedPlugin.description} ${selectedPlugin.returnDescription || ""}`,
        );

      if (objectiveWantsContent && selectedDisclaimsContent) {
        const alternative = availablePlugins.find(
          (p) =>
            p.name !== cleanPluginId &&
            !/\b(not|cannot|does not|no)\b[^.]*\bcontent\b|\bcontent\b[^.]*\b(not|cannot|does not)\b/i.test(
              `${p.description} ${p.returnDescription || ""}`,
            ) &&
            /\bcontent|text\b/i.test(`${p.description} ${p.returnDescription || ""}`),
        );
        if (alternative) {
          cleanPluginId = alternative.name;
        }
      }
    }

    const node: GraphNode = {
      id: cleanId,
      name: n.name,
      type: nodeType,
      config:
        nodeType === "plugin"
          ? { pluginId: cleanPluginId }
          : seedPlugins
            ? { plugins: seedPlugins }
            : (n as any).plugins && (n as any).plugins.length > 0
              ? { plugins: (n as any).plugins }
              : {},
    };
    intermediateNodes.push(node);
    graph.nodes.push(node);
  }

  // 3. Deterministically inject native End node via code
  const endNode: GraphNode = {
    id: "end",
    name: "End",
    type: "end",
    config: {},
  };
  graph.nodes.push(endNode);

  // Map and Sanitize Edges
  const validNodeIds = new Set(graph.nodes.map((n) => n.id));
  const rawEdges: GraphEdge[] = [];

  for (const raw of skeleton.edges) {
    let s = idMap.get(raw.source) || raw.source;
    let t = idMap.get(raw.target) || raw.target;

    if (bypassMap.has(raw.source)) {
      continue;
    }
    if (bypassMap.has(raw.target)) {
      const realTarget = bypassMap.get(raw.target)!;
      t = idMap.get(realTarget) || realTarget;
    }
    // Forbid self-loops on a node
    if (s === t) continue;
    if (!validNodeIds.has(s) || !validNodeIds.has(t)) continue;

    const sourceNode = graph.nodes.find((n) => n.id === s);
    const isCondition = sourceNode?.type === "condition";

    let cleanPath: "true" | "false" | undefined = undefined;
    if (isCondition) {
      const pRaw = (raw.path || "").toLowerCase().trim();

      if (
        pRaw === "false" ||
        pRaw === "no" ||
        pRaw === "fail" ||
        pRaw === "retry" ||
        pRaw === "loop" ||
        pRaw === "loopback"
      ) {
        cleanPath = "false";
      } else {
        cleanPath = "true";
      }
    }

    rawEdges.push({
      id: `edge_${s}_${t}${cleanPath ? `_${cleanPath}` : ""}`,
      source: s,
      target: t,
      isConditional: isCondition,
      path: cleanPath,
    });
  }

  return { startNode, endNode, intermediateNodes, nodeDescriptions, rawEdges };
}
