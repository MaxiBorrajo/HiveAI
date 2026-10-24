import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ModelSelection } from "../../providers/model-selection.ts";
import type {
  GraphNode,
  IncrementalEvent,
  LangGraphAbstraction,
  PluginInfo,
} from "../types.ts";
import { configureLlmNode } from "./llm-node-configurator.ts";
import { configurePluginNode } from "./plugin-node-configurator.ts";
import { configureConditionNode } from "./condition-node-configurator.ts";
import { describeNeighbor } from "./prompt-helpers.ts";

export async function* configureNodes(
  intermediateNodes: GraphNode[],
  ctx: {
    prompt: string;
    modelName: string;
    modelSelection?: ModelSelection;
    availablePlugins: PluginInfo[];
    pluginNames: Set<string>;
    configLlm: BaseChatModel;
    graph: LangGraphAbstraction;
    nodeDescriptions: Map<string, string>;
    allIntermediateNodes?: GraphNode[];
  },
): AsyncGenerator<IncrementalEvent, void, unknown> {
  const {
    prompt,
    modelName,
    modelSelection,
    availablePlugins,
    pluginNames,
    configLlm,
    graph,
    nodeDescriptions,
    allIntermediateNodes = intermediateNodes,
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
      modelSelection,
      availablePlugins,
      pluginNames,
      configLlm,
      graph,
      intermediateNodes: allIntermediateNodes,
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
    modelSelection?: ModelSelection;
    availablePlugins: PluginInfo[];
    pluginNames: Set<string>;
    configLlm: BaseChatModel;
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
    modelSelection,
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
        modelSelection,
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

