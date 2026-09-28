import { ChatOllama } from "@langchain/ollama";
import type { GraphEdge, GraphNode, LangGraphAbstraction } from "./types.ts";
import type { InputMappingViolation } from "./validation.ts";
import { type PluginInfo, runTopologyCompilerPhase } from "./generation/topology-compiler.ts";
import { normalizeSkeletonToGraph } from "./generation/skeleton-normalizer.ts";
import { sanitizeGraphEdges } from "./generation/graph-sanitizer.ts";
import { configureLlmNode } from "./generation/llm-node-configurator.ts";
import { configurePluginNode } from "./generation/plugin-node-configurator.ts";
import { configureConditionNode } from "./generation/condition-node-configurator.ts";
import { configureEndNodeDeliverable } from "./generation/end-node-configurator.ts";
import { runInterpolationSelfCorrection } from "./generation/interpolation-self-correction.ts";

export type { PluginInfo };

export type IncrementalEvent =
  | { type: "planning"; thoughts: string }
  | {
      type: "node_added";
      node: GraphNode;
      edge?: GraphEdge;
      stateProperties?: Record<string, any>;
    }
  | {
      type: "node_configuring";
      nodeId: string;
      nodeName: string;
    }
  | {
      type: "node_updated";
      node: GraphNode;
      stateProperties?: Record<string, any>;
    }
  | { type: "edge_added"; edge: GraphEdge }
  | {
      type: "validation_error";
      violations: InputMappingViolation[];
      attempt: number;
    }
  | {
      type: "node_fixed";
      node: GraphNode;
      stateProperties?: Record<string, any>;
    };

// Describes a real graph neighbor (predecessor/successor, resolved via
// graph.edges) so each node's configurator can see what tools/outputKey a
// neighbor already covers, instead of blindly duplicating them. Reads
// config.plugins/outputKey directly, which is only meaningful for a
// predecessor already configured earlier in this same sequential loop — a
// successor not yet configured will only show its role/type.
function describeNeighbor(n: GraphNode | undefined, nodeDescriptions: Map<string, string>): string {
  if (!n) return "none";
  const role = nodeDescriptions.get(n.id) || n.name;
  const plugins = Array.isArray(n.config?.plugins)
    ? (n.config.plugins as string[])
    : [];
  const outputKey = n.config?.outputKey as string | undefined;
  return `"${n.name}" (type: ${n.type}, role: "${role}"${outputKey ? `, outputKey: "${outputKey}"` : ""}${plugins.length ? `, tools: [${plugins.join(", ")}]` : ""})`;
}

export async function* generateIncrementalGraph(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  currentGraph?: LangGraphAbstraction,
  _targetNodeId?: string,
): AsyncGenerator<IncrementalEvent, LangGraphAbstraction, unknown> {
  const pluginNames = new Set(availablePlugins.map((p) => p.name));
  const configLlm = new ChatOllama({ model: modelName, temperature: 0.05 });
  // buildPluginConfigSchema is rebuilt per-node (both in Phase 2 and Phase
  // 2.6's self-correction) using that node's already-resolved pluginDef, so
  // inputMapping's per-field types come from the REAL plugin's Zod schema —
  // see plugin-node-configurator.ts and interpolation-self-correction.ts.
  // buildLlmConfigSchema is rebuilt per-node inside the Phase 2 loop (its
  // inputMapping value enum needs the CURRENT graph.stateSchema keys at the
  // time each node is configured) — see llm-node-configurator.ts, same
  // pattern buildConditionNodeSchema already uses for condition nodes.
  // The end-node deliverable agent is built later, in Phase 2.5, once
  // graph.stateSchema is fully populated by every node's real outputKey
  // (same reasoning: contentKey's enum needs the final state keys, not
  // whatever existed at setup time).

  const graph: LangGraphAbstraction = currentGraph
    ? JSON.parse(JSON.stringify(currentGraph))
    : {
        nodes: [],
        edges: [],
        stateSchema: {
          input: {
            type: "string",
            description: "User initial query or prompt for this execution",
            required: false,
          },
          cwd: {
            type: "string",
            description: "Current working directory / workspace path",
            required: false,
          },
          os: {
            type: "string",
            description: "Host operating system platform (e.g. linux, darwin, windows)",
            required: false,
          },
          // Deliberately NOT seeding "result" here: it is a runtime-only slot
          // that the executor writes AFTER the graph finishes (see
          // runExecution/index.ts), never before. Seeding it upfront made it
          // appear as an "available" variable to the Phase 2 node
          // configurators, which then hallucinated reads of "${result}" from
          // nodes that never actually produced it. The real mechanism for
          // referencing the final deliverable is the end node's contentKey,
          // which points at whatever outputKey the last producing node
          // actually used.
        },
      };

  console.log(
    `\n[Visual Builder - Generator] === Starting Two-Phase Graph Generation ===`,
  );
  console.log(`[Visual Builder - Generator] Model: "${modelName}"`);
  console.log(`[Visual Builder - Generator] User Objective: "${prompt}"`);
  console.log(
    `[Visual Builder - Generator] Available plugins (${availablePlugins.length}): [${availablePlugins.map((p) => p.name).join(", ")}]`,
  );

  // ==========================================
  // PHASE 1: TOPOLOGY COMPILER
  // ==========================================
  yield {
    type: "planning",
    thoughts: "Designing the workflow structure...",
  };

  const skeleton = await runTopologyCompilerPhase(prompt, modelName, availablePlugins);

  yield {
    type: "planning",
    thoughts: skeleton.thought,
  };

  const { startNode, endNode, intermediateNodes, nodeDescriptions, rawEdges } =
    normalizeSkeletonToGraph(skeleton, graph, availablePlugins, prompt);

  yield {
    type: "node_added",
    node: startNode,
  };

  // ==============================================================
  // DETERMINISTIC GRAPH INTEGRITY & CONNECTIVITY GUARANTEES (BY CODE)
  // ==============================================================
  graph.edges = sanitizeGraphEdges(intermediateNodes, rawEdges);

  // Stream Phase 1 nodes and primary incoming edges
  const emittedEdges = new Set<string>();
  for (const node of intermediateNodes) {
    const primaryEdge = graph.edges.find(
      (e) => e.target === node.id && !emittedEdges.has(e.id),
    );
    if (primaryEdge) emittedEdges.add(primaryEdge.id);

    yield {
      type: "node_added",
      node,
      edge: primaryEdge,
    };
  }

  // Stream remaining edges
  for (const edge of graph.edges) {
    if (!emittedEdges.has(edge.id)) {
      emittedEdges.add(edge.id);
      yield {
        type: "edge_added",
        edge,
      };
    }
  }

  yield {
    type: "node_added",
    node: endNode,
  };

  // ==========================================
  // PHASE 2: DETAILED NODE CONFIGURATION
  // ==========================================
  console.log(`[Visual Builder - Generator] === Phase 2: Configuring Nodes ===`);

  for (const node of intermediateNodes) {
    console.log(
      `[Visual Builder - Generator] Configuring node [${node.type}] "${node.name}" (${node.id})...`,
    );

    yield {
      type: "node_configuring",
      nodeId: node.id,
      nodeName: node.name,
    };

    const graphStateText = `Current Memory Variables (State):
${
  Object.keys(graph.stateSchema).length > 0
    ? Object.entries(graph.stateSchema)
        .map(([k, v]) => `  - ${k} (${(v as any).type})`)
        .join("\n")
    : "  - input (string)"
}`;

    const predecessors = graph.edges
      .filter((e) => e.target === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.source));
    const successors = graph.edges
      .filter((e) => e.source === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.target));
    const neighborHint = `\nGraph Neighbors (use this to avoid duplicating work or tools already covered):
- Predecessor(s): ${predecessors.length ? predecessors.map((n) => describeNeighbor(n, nodeDescriptions)).join("; ") : "none (this is the first node)"}
- Successor(s): ${successors.length ? successors.map((n) => describeNeighbor(n, nodeDescriptions)).join("; ") : "none (this feeds into End)"}
IMPORTANT: If a predecessor already has a tool and produced an outputKey that already contains what you need, do NOT re-invoke that tool or duplicate its outputKey — read its output via a plain "\${outputKey}" reference instead. Only add a tool to THIS node if the predecessor's output does not already cover it.`;

    if (node.type === "llm") {
      await configureLlmNode(node, {
        prompt,
        modelName,
        availablePlugins,
        pluginNames,
        configLlm,
        graph,
        intermediateNodes,
        nodeDescriptions,
        neighborHint,
        graphStateText,
      });
      yield {
        type: "node_updated",
        node,
        stateProperties: graph.stateSchema,
      };
    } else if (node.type === "plugin") {
      const { usedFallback } = await configurePluginNode(node, {
        prompt,
        availablePlugins,
        pluginNames,
        configLlm,
        graph,
        intermediateNodes,
        nodeDescriptions,
        neighborHint,
        graphStateText,
      });
      // Matches the pre-refactor behavior: the fallback path omits
      // `stateProperties` from this event, unlike the success path.
      yield usedFallback
        ? { type: "node_updated", node }
        : { type: "node_updated", node, stateProperties: graph.stateSchema };
    } else if (node.type === "condition") {
      const { usedFallback } = await configureConditionNode(node, {
        prompt,
        configLlm,
        graph,
        graphStateText,
      });
      yield usedFallback
        ? { type: "node_updated", node }
        : { type: "node_updated", node, stateProperties: graph.stateSchema };
    }
  }

  // ==========================================
  // PHASE 2.5: CONFIGURE END NODE DELIVERABLE (Structured Output Spec)
  // ==========================================
  console.log(`[Visual Builder - Generator] === Phase 2.5: Configuring End Node Deliverable ===`);
  yield {
    type: "planning",
    thoughts: "Configuring End Node Deliverable contract and structured output specification...",
  };

  await configureEndNodeDeliverable(endNode, {
    prompt,
    configLlm,
    graph,
    intermediateNodes,
  });

  yield {
    type: "node_updated",
    node: endNode,
  };

  // ==========================================
  // PHASE 2.6: INTERPOLATION GRAMMAR VALIDATION & SELF-CORRECTION
  // ==========================================
  yield* runInterpolationSelfCorrection({
    graph,
    availablePlugins,
    configLlm,
    nodeDescriptions,
  });

  console.log(
    `[Visual Builder - Generator] === Workflow Generation Complete ===`,
  );
  return graph;
}
