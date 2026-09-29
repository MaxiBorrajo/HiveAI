import {
  GraphEdge,
  GraphNode,
  LangGraphAbstraction,
  NormalizedSkeleton,
  SkeletonEdge,
  SkeletonNode,
} from "../types.ts";
import { PluginInfo, WorkflowSkeleton, normalizePluginName } from "./topology-compiler.ts";

function isBoundaryAlias(n: SkeletonNode, boundary: "start" | "end"): boolean {
  const id = n.id.toLowerCase().trim();
  const name = n.name.toLowerCase().trim();
  return (
    id === boundary || id === `${boundary}_step` || id === `${boundary}_node` || name === boundary
  );
}

// The graph builds its own start/end terminals, so any start/end node the LLM
// emitted is dropped and its edges are redirected through `bypassMap`.
function separateBoundaryAliases(skeleton: WorkflowSkeleton) {
  const bypassMap = new Map<string, string>();
  const nodesToKeep: SkeletonNode[] = [];

  for (const n of skeleton.nodes) {
    if (isBoundaryAlias(n, "start")) {
      const outgoing = skeleton.edges.find((e) => e.source === n.id);
      if (outgoing) bypassMap.set(n.id, outgoing.target);
    } else if (isBoundaryAlias(n, "end")) {
      bypassMap.set(n.id, "end");
    } else {
      nodesToKeep.push(n);
    }
  }
  return { bypassMap, nodesToKeep };
}

function makeUniqueNodeId(rawId: string, graph: LangGraphAbstraction): string {
  const cleanId = rawId.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const collides = cleanId === "start" || cleanId === "end" || graph.nodes.some((x) => x.id === cleanId);
  return collides ? `${cleanId}_step` : cleanId;
}

// The skeleton has already been checked by findSkeletonShapeViolations (and
// sent back to the LLM for correction), so this only maps what is left. A node
// that is still inconsistent after the retries is reduced to the nearest valid
// shape structurally — never by guessing from its wording.
function buildGraphNode(
  n: SkeletonNode,
  cleanId: string,
  availablePlugins: PluginInfo[],
): GraphNode {
  const pluginId = normalizePluginName(n.pluginId, availablePlugins);

  if (n.type === "plugin" && pluginId) {
    return { id: cleanId, name: n.name, type: "plugin", config: { pluginId } };
  }
  if (n.type === "condition") {
    return { id: cleanId, name: n.name, type: "condition", config: {} };
  }

  const plugins = n.plugins?.length ? n.plugins : pluginId ? [pluginId] : [];
  return {
    id: cleanId,
    name: n.name,
    type: "llm",
    config: plugins.length > 0 ? { plugins } : {},
  };
}

function buildEdges(
  skeletonEdges: SkeletonEdge[],
  idMap: Map<string, string>,
  bypassMap: Map<string, string>,
  graph: LangGraphAbstraction,
): GraphEdge[] {
  const validNodeIds = new Set(graph.nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];

  for (const raw of skeletonEdges) {
    if (bypassMap.has(raw.source)) continue;

    const s = idMap.get(raw.source) || raw.source;
    let t = idMap.get(raw.target) || raw.target;
    if (bypassMap.has(raw.target)) {
      const realTarget = bypassMap.get(raw.target)!;
      t = idMap.get(realTarget) || realTarget;
    }

    if (s === t || !validNodeIds.has(s) || !validNodeIds.has(t)) continue;

    const isCondition = graph.nodes.find((n) => n.id === s)?.type === "condition";
    const path = isCondition ? raw.path ?? "true" : undefined;

    edges.push({
      id: `edge_${s}_${t}${path ? `_${path}` : ""}`,
      source: s,
      target: t,
      isConditional: isCondition,
      path,
    });
  }
  return edges;
}

export function normalizeSkeletonToGraph(
  skeleton: WorkflowSkeleton,
  graph: LangGraphAbstraction,
  availablePlugins: PluginInfo[],
): NormalizedSkeleton {
  const startNode: GraphNode = { id: "start", name: "Start", type: "start", config: {} };
  graph.nodes.push(startNode);

  const { bypassMap, nodesToKeep } = separateBoundaryAliases(skeleton);

  const idMap = new Map<string, string>([
    ["start", "start"],
    ["end", "end"],
  ]);
  const intermediateNodes: GraphNode[] = [];
  const nodeDescriptions = new Map<string, string>();

  for (const n of nodesToKeep) {
    const cleanId = makeUniqueNodeId(n.id, graph);
    idMap.set(n.id, cleanId);
    nodeDescriptions.set(cleanId, n.description);

    const node = buildGraphNode(n, cleanId, availablePlugins);
    intermediateNodes.push(node);
    graph.nodes.push(node);
  }

  const endNode: GraphNode = { id: "end", name: "End", type: "end", config: {} };
  graph.nodes.push(endNode);

  const rawEdges = buildEdges(skeleton.edges, idMap, bypassMap, graph);

  return { startNode, endNode, intermediateNodes, nodeDescriptions, rawEdges };
}
