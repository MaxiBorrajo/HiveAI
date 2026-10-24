import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createBaseStateSchema, createDraftGraph } from "../graph-factory.ts";
import type {
  GraphNode,
  IncrementalEvent,
  LangGraphAbstraction,
  PluginInfo,
} from "../types.ts";
import { configureEndNodeDeliverable } from "./end-node-configurator.ts";
import { runInterpolationSelfCorrection } from "./interpolation-self-correction.ts";
import { configureNodes } from "./node-configuration.ts";
import { requestValidatedSkeleton } from "./skeleton-phase.ts";
import { sanitizeGraphEdges } from "./graph-sanitizer.ts";
import type { ModelSelection } from "../../providers/model-selection.ts";
import { BUILTIN_STATE_KEYS } from "../constants.ts";

export async function* reconfigureTargetNode(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  pluginNames: Set<string>,
  configLlm: BaseChatModel,
  currentGraph: LangGraphAbstraction,
  target: GraphNode,
  modelSelection?: ModelSelection,
): AsyncGenerator<IncrementalEvent, LangGraphAbstraction, unknown> {
  const graph: LangGraphAbstraction = createDraftGraph(currentGraph);
  const node = graph.nodes.find((n) => n.id === target.id)!;
  const intermediateNodes = graph.nodes.filter(
    (n) => n.type !== "start" && n.type !== "end",
  );

  console.log(
    `[Visual Builder - Generator] === Reconfiguring single node [${node.type}] "${node.name}" (${node.id}) ===`,
  );

  if (node.type === "start") return graph;

  const request =
    `Current configuration of this node (keep everything the request does not mention):\n${
      JSON.stringify(node.config)
    }\n\nRequested change: ${prompt}`;

  if (node.type === "end") {
    yield { type: "node_configuring", nodeId: node.id, nodeName: node.name };
    await configureEndNodeDeliverable(node, {
      prompt: request,
      configLlm,
      graph,
      intermediateNodes,
    });
    yield { type: "node_updated", node, stateProperties: graph.stateSchema };
    return graph;
  }

  const nodeDescriptions = new Map<string, string>(
    intermediateNodes.map((n) => [n.id, n.name]),
  );
  nodeDescriptions.set(node.id, `${node.name} — ${prompt}`);

  yield* configureNodes([node], {
    prompt: request,
    modelName,
    modelSelection,
    availablePlugins,
    pluginNames,
    configLlm,
    graph,
    nodeDescriptions,
    allIntermediateNodes: intermediateNodes,
  });

  yield* runInterpolationSelfCorrection({
    graph,
    availablePlugins,
    configLlm,
    nodeDescriptions,
  });

  return graph;
}


function sameTools(a: unknown, b: unknown): boolean {
  const left = new Set(Array.isArray(a) ? (a as string[]) : []);
  const right = new Set(Array.isArray(b) ? (b as string[]) : []);
  return left.size === right.size && [...left].every((t) => right.has(t));
}

function isUnchanged(previous: GraphNode | undefined, next: GraphNode, modified: boolean): boolean {
  if (!previous || modified || previous.type !== next.type) return false;
  if (next.type === "plugin") return previous.config?.pluginId === next.config?.pluginId;
  if (next.type === "llm") return sameTools(previous.config?.plugins, next.config?.plugins);
  return true;
}

function requestWithConfig(node: GraphNode, prompt: string): string {
  return `Current configuration of this node (keep everything the request does not mention):\n${
    JSON.stringify(node.config)
  }\n\nRequested change: ${prompt}`;
}

function outputKeysOf(graph: LangGraphAbstraction): Set<string> {
  return new Set(
    graph.nodes
      .map((n) => n.config?.outputKey)
      .filter((k): k is string => typeof k === "string" && k.length > 0),
  );
}

export async function* editExistingGraph(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  pluginNames: Set<string>,
  configLlm: BaseChatModel,
  current: LangGraphAbstraction,
  modelSelection?: ModelSelection,
): AsyncGenerator<IncrementalEvent, LangGraphAbstraction, unknown> {
  const previousById = new Map(current.nodes.map((n) => [n.id, n]));
  const previousKeys = outputKeysOf(current);

  const graph: LangGraphAbstraction = {
    nodes: [],
    edges: [],
    stateSchema: { ...createBaseStateSchema(), ...current.stateSchema },
  };

  yield { type: "planning", thoughts: "Planning the changes to the workflow..." };

  const normalized = yield* requestValidatedSkeleton(
    prompt,
    modelName,
    availablePlugins,
    graph,
    current,
    modelSelection?.orchestrator,
    modelSelection,
  );
  const { intermediateNodes, rawEdges, nodeDescriptions, modifiedIds } = normalized;

  const startNode = previousById.get("start") ?? normalized.startNode;
  const endNode = previousById.get("end") ?? normalized.endNode;

  const toConfigure: { node: GraphNode; request: string }[] = [];
  const functionalNodes: GraphNode[] = [];
  let changed = false;

  for (const planned of intermediateNodes) {
    const previous = previousById.get(planned.id);
    if (isUnchanged(previous, planned, modifiedIds.has(planned.id))) {
      functionalNodes.push(previous!);
      continue;
    }
    changed = true;
    if (previous && previous.type === planned.type) {
      const config = { ...previous.config, ...planned.config };
      if (planned.type === "llm" && !planned.config?.plugins) delete config.plugins;
      const node = { ...previous, config };
      functionalNodes.push(node);
      toConfigure.push({ node, request: requestWithConfig(previous, prompt) });
    } else {
      functionalNodes.push(planned);
      toConfigure.push({ node: planned, request: prompt });
    }
  }

  const plannedIds = new Set(functionalNodes.map((n) => n.id));
  const removed = current.nodes.filter(
    (n) => n.type !== "start" && n.type !== "end" && !plannedIds.has(n.id),
  );
  if (removed.length > 0) changed = true;

  graph.nodes = [startNode, ...functionalNodes, endNode];
  graph.edges = sanitizeGraphEdges(functionalNodes, rawEdges);

  for (const node of removed) yield { type: "node_deleted", nodeId: node.id };

  const edgesBySource = new Set<string>();
  for (const { node } of toConfigure) {
    const edge = graph.edges.find((e) => e.target === node.id && !edgesBySource.has(e.id));
    if (edge) edgesBySource.add(edge.id);
    if (!previousById.has(node.id)) yield { type: "node_added", node, edge };
  }

  const descriptions = new Map(nodeDescriptions);
  for (const node of functionalNodes) {
    if (!descriptions.has(node.id)) descriptions.set(node.id, node.name);
  }

  for (const { node, request } of toConfigure) {
    yield* configureNodes([node], {
      prompt: request,
      modelName,
      modelSelection,
      availablePlugins,
      pluginNames,
      configLlm,
      graph,
      nodeDescriptions: descriptions,
      allIntermediateNodes: functionalNodes,
    });
  }

  const liveKeys = outputKeysOf(graph);
  for (const key of previousKeys) {
    if (!liveKeys.has(key) && !BUILTIN_STATE_KEYS.includes(key)) delete graph.stateSchema[key];
  }

  const output = (endNode.config?.output ?? {}) as { contentKey?: string };
  const resultVariableGone = !!output.contentKey && !(output.contentKey in graph.stateSchema);
  if (changed || resultVariableGone) {
    yield {
      type: "planning",
      thoughts: "Reviewing what the workflow delivers as its final result...",
    };
    await configureEndNodeDeliverable(endNode, {
      prompt: requestWithConfig(endNode, prompt),
      configLlm,
      graph,
      intermediateNodes: functionalNodes,
    });
    yield { type: "node_updated", node: endNode, stateProperties: graph.stateSchema };
  }

  yield* runInterpolationSelfCorrection({
    graph,
    availablePlugins,
    configLlm,
    nodeDescriptions: descriptions,
  });

  return graph;
}
