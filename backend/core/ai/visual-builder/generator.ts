import { ChatOllama } from "@langchain/ollama";
import type {
  GraphEdge,
  GraphNode,
  IncrementalEvent,
  LangGraphAbstraction,
} from "./types.ts";
import {
  type PluginInfo,
  runTopologyCompilerPhase,
} from "./generation/topology-compiler.ts";
import {
  type NormalizedSkeleton,
  normalizeSkeletonToGraph,
} from "./generation/skeleton-normalizer.ts";
import {
  findMissingConditionBranches,
  fillMissingConditionBranches,
  findConvergingConditionBranches,
  sanitizeGraphEdges,
} from "./generation/graph-sanitizer.ts";
import { configureLlmNode } from "./generation/llm-node-configurator.ts";
import { configurePluginNode } from "./generation/plugin-node-configurator.ts";
import { configureConditionNode } from "./generation/condition-node-configurator.ts";
import { configureEndNodeDeliverable } from "./generation/end-node-configurator.ts";
import { runInterpolationSelfCorrection } from "./generation/interpolation-self-correction.ts";
import { describeNeighbor } from "./utils.ts";

export async function* generateIncrementalGraph(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  currentGraph?: LangGraphAbstraction,
  _targetNodeId?: string,
): AsyncGenerator<IncrementalEvent, LangGraphAbstraction, unknown> {
  const pluginNames = new Set(availablePlugins.map((p) => p.name));
  const configLlm = new ChatOllama({ model: modelName, temperature: 0.05 });

  const graph: LangGraphAbstraction = createDraftGraph(currentGraph);

  console.log(
    `\n[Visual Builder - Generator] === Starting Two-Phase Graph Generation ===`,
  );
  console.log(`[Visual Builder - Generator] Model: "${modelName}"`);
  console.log(`[Visual Builder - Generator] User Objective: "${prompt}"`);
  console.log(
    `[Visual Builder - Generator] Available plugins (${availablePlugins.length}): [${availablePlugins.map((p) => p.name).join(", ")}]`,
  );

  yield {
    type: "planning",
    thoughts: "Designing the workflow structure...",
  };

  const { startNode, endNode, intermediateNodes, nodeDescriptions, rawEdges } =
    yield* requestValidatedSkeleton(prompt, modelName, availablePlugins, graph);

  yield {
    type: "node_added",
    node: startNode,
  };

  yield* streamSkeleton(graph, intermediateNodes, rawEdges, endNode);

  console.log(
    `[Visual Builder - Generator] === Phase 2: Configuring Nodes ===`,
  );

  yield* configureNodes(intermediateNodes, {
    prompt,
    modelName,
    availablePlugins,
    pluginNames,
    configLlm,
    graph,
    nodeDescriptions,
  });

  console.log(
    `[Visual Builder - Generator] === Phase 2.5: Configuring End Node Deliverable ===`,
  );

  yield {
    type: "planning",
    thoughts:
      "Configuring End Node Deliverable contract and structured output specification...",
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

const MAX_SKELETON_RETRIES = 1;

// Phase 1: gets the workflow skeleton from the Topology Compiler and
// validates that every condition node has both a "true" and a "false"
// branch. If a branch is missing, the violation is sent back to the LLM as
// retry feedback (see runTopologyCompilerPhase's correctionContext) instead
// of being silently invented — the deterministic fill is only applied once
// MAX_SKELETON_RETRIES is exhausted, as a true last resort.
async function* requestValidatedSkeleton(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  graph: LangGraphAbstraction,
): AsyncGenerator<IncrementalEvent, NormalizedSkeleton, unknown> {
  const nodesBefore = graph.nodes.length;
  let correctionContext:
    | { previousSkeleton: Awaited<ReturnType<typeof runTopologyCompilerPhase>>; violations: string[] }
    | undefined;

  for (let attempt = 1; attempt <= MAX_SKELETON_RETRIES + 1; attempt++) {
    const skeleton = await runTopologyCompilerPhase(
      prompt,
      modelName,
      availablePlugins,
      correctionContext,
    );

    yield { type: "planning", thoughts: skeleton.thought };

    // Undo the previous attempt's node pushes before normalizing again —
    // normalizeSkeletonToGraph mutates graph.nodes directly.
    graph.nodes.length = nodesBefore;
    const normalized = normalizeSkeletonToGraph(skeleton, graph, availablePlugins, prompt);

    const violations = [
      ...findMissingConditionBranches(normalized.intermediateNodes, normalized.rawEdges),
      ...findConvergingConditionBranches(normalized.intermediateNodes, normalized.rawEdges),
    ];
    if (violations.length === 0) return normalized;

    console.warn(
      `[Visual Builder - Generator] Skeleton attempt ${attempt} has invalid condition branches:`,
      violations,
    );

    if (attempt > MAX_SKELETON_RETRIES) {
      // A converging true/false branch isn't fatal (LangGraph compiles it
      // fine, the condition just ends up pointless) so it's left as-is here
      // — only the missing-branch case needs a deterministic fill to stay
      // compilable at all.
      fillMissingConditionBranches(normalized.intermediateNodes, normalized.rawEdges);
      return normalized;
    }

    yield { type: "validation_error", violations, attempt };

    correctionContext = {
      previousSkeleton: skeleton,
      violations: violations.map((v) => v.reason),
    };
  }

  // Unreachable: the loop above always returns before exhausting its bound.
  throw new Error("requestValidatedSkeleton: retry loop exited without a result");
}

function* streamSkeleton(
  graph: LangGraphAbstraction,
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
  endNode: GraphNode,
): Generator<IncrementalEvent, void, unknown> {
  graph.edges = sanitizeGraphEdges(intermediateNodes, rawEdges);

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
}

async function* configureNodes(
  intermediateNodes: GraphNode[],
  ctx: {
    prompt: string;
    modelName: string;
    availablePlugins: PluginInfo[];
    pluginNames: Set<string>;
    configLlm: ChatOllama;
    graph: LangGraphAbstraction;
    nodeDescriptions: Map<string, string>;
  },
): AsyncGenerator<IncrementalEvent, void, unknown> {
  const {
    prompt,
    modelName,
    availablePlugins,
    pluginNames,
    configLlm,
    graph,
    nodeDescriptions,
  } = ctx;

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

    const neighborHint = `\n
    Graph Neighbors (use this to avoid duplicating work or tools already covered):
    - Predecessor(s): ${predecessors.length ? predecessors.map((n) => describeNeighbor(n, nodeDescriptions)).join("; ") : "none (this is the first node)"}
    - Successor(s): ${successors.length ? successors.map((n) => describeNeighbor(n, nodeDescriptions)).join("; ") : "none (this feeds into End)"}
    IMPORTANT: If a predecessor already has a tool and produced an outputKey that already contains what you need, do NOT re-invoke that tool or duplicate its outputKey — read its output via a plain "\${outputKey}" reference instead. Only add a tool to THIS node if the predecessor's output does not already cover it.`;

    yield* configureNode(node, {
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
  }
}

async function* configureNode(
  node: GraphNode,
  ctx: {
    prompt: string;
    modelName: string;
    availablePlugins: PluginInfo[];
    pluginNames: Set<string>;
    configLlm: ChatOllama;
    graph: LangGraphAbstraction;
    intermediateNodes: GraphNode[];
    nodeDescriptions: Map<string, string>;
    neighborHint: string;
    graphStateText: string;
  },
): AsyncGenerator<IncrementalEvent, void, unknown> {
  const {
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
  } = ctx;

  switch (node.type) {
    case "llm": {
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
      break;
    }
    case "plugin": {
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
      break;
    }
    case "condition": {
      const { usedFallback } = await configureConditionNode(node, {
        prompt,
        configLlm,
        graph,
        graphStateText,
      });
      yield usedFallback
        ? { type: "node_updated", node }
        : { type: "node_updated", node, stateProperties: graph.stateSchema };
      break;
    }
  }
}

function createDraftGraph(
  currentGraph?: LangGraphAbstraction,
): LangGraphAbstraction {
  if (currentGraph) return JSON.parse(JSON.stringify(currentGraph));

  return {
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
        description:
          "Host operating system platform (e.g. linux, darwin, windows)",
        required: false,
      },
    },
  };
}
