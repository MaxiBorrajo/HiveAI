import { createChatModel } from "../../providers/create-chat-model.ts";
import { normalizeModelRef } from "../../providers/types.ts";
import type { ModelSelection } from "../../providers/model-selection.ts";
import { createDraftGraph } from "../graph-factory.ts";
import type {
  GraphEdge,
  GraphNode,
  IncrementalEvent,
  LangGraphAbstraction,
  NormalizedSkeleton,
  PluginInfo,
} from "../types.ts";
import {
  runTopologyCompilerPhase,
} from "./topology-compiler.ts";
import { normalizeSkeletonToGraph } from "./skeleton-normalizer.ts";
import { findSkeletonShapeViolations } from "./skeleton-validator.ts";
import {
  findMissingConditionBranches,
  fillMissingConditionBranches,
  findConvergingConditionBranches,
  sanitizeGraphEdges,
} from "./graph-sanitizer.ts";
import { configureNodes } from "./node-configuration.ts";
import { requestValidatedSkeleton } from "./skeleton-phase.ts";
import { editExistingGraph, reconfigureTargetNode } from "./edit-graph.ts";
import { configureEndNodeDeliverable } from "./end-node-configurator.ts";
import { runInterpolationSelfCorrection } from "./interpolation-self-correction.ts";
import { describeNeighbor } from "./prompt-helpers.ts";

export async function* generateIncrementalGraph(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  currentGraph?: LangGraphAbstraction,
  targetNodeId?: string,
  modelSelection?: ModelSelection,
): AsyncGenerator<IncrementalEvent, LangGraphAbstraction, unknown> {
  const pluginNames = new Set(availablePlugins.map((p) => p.name));
  const orchestrator = modelSelection?.orchestrator ?? normalizeModelRef(modelName);
  const configLlm = await createChatModel(orchestrator, { temperature: 0.05 });

  const existingNodes = currentGraph?.nodes.filter(
    (n) => n.type !== "start" && n.type !== "end",
  ) ?? [];

  if (currentGraph && targetNodeId) {
    const target = currentGraph.nodes.find((n) => n.id === targetNodeId);
    if (!target) throw new Error(`Node "${targetNodeId}" does not exist in the graph.`);
    return yield* reconfigureTargetNode(prompt, modelName, availablePlugins, pluginNames, configLlm, currentGraph, target, modelSelection);
  }

  if (currentGraph && existingNodes.length > 0) {
    return yield* editExistingGraph(prompt, modelName, availablePlugins, pluginNames, configLlm, currentGraph, modelSelection);
  }

  const graph: LangGraphAbstraction = createDraftGraph(
    currentGraph ? { ...currentGraph, nodes: [], edges: [] } : undefined,
  );

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
    yield* requestValidatedSkeleton(
      prompt,
      modelName,
      availablePlugins,
      graph,
      undefined,
      orchestrator,
      modelSelection,
    );

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
    modelSelection,
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

