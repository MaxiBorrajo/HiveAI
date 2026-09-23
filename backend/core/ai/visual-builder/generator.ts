import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import {
  LangGraphAbstraction,
  GraphNode,
  GraphEdge,
  NodeType,
} from "./types.ts";
import { z } from "zod";

// Zod schema to force the LLM to return exactly this structure
const statePropertyDefinitionSchema = z.object({
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string().optional(),
  default: z.any().optional(),
  required: z.boolean().default(false),
  reducerStrategy: z
    .enum(["overwrite", "append", "merge_dict", "sum"])
    .optional(),
});

export interface PluginInfo {
  name: string;
  description: string;
}

// ============================================================================
// INCREMENTAL NODE-BY-NODE WORKFLOW GENERATION
// ============================================================================

const nodeProposalSchema = z.discriminatedUnion("type", [
  z.object({
    id: z
      .string()
      .describe(
        "Unique lowercase alphanumeric identifier (e.g. 'web_search_topics', 'filter_articles')",
      ),
    name: z.string().describe("Human-readable title for the node UI"),
    type: z.literal("llm"),
    config: z.object({
      model: z.string().describe("Model name to use"),
      temperature: z
        .number()
        .min(0)
        .max(1)
        .describe("Temperature from 0.0 to 1.0"),
      systemPrompt: z.string().describe("The instructions for the LLM"),
      plugins: z
        .array(z.string())
        .optional()
        .describe("List of plugin names this LLM can use as tools"),
      outputKey: z
        .string()
        .optional()
        .describe("State property where the output should be saved"),
    }),
  }),
  z.object({
    id: z.string().describe("Unique lowercase alphanumeric identifier"),
    name: z.string().describe("Human-readable title for the node UI"),
    type: z.literal("plugin"),
    config: z.object({
      pluginId: z.string().describe("The name of the plugin to execute"),
      inputMapping: z
        .record(z.string(), z.string())
        .optional()
        .describe("Map of plugin inputs to state property keys"),
      outputKey: z
        .string()
        .optional()
        .describe("State property where the output should be saved"),
    }),
  }),
  z.object({
    id: z.string().describe("Unique lowercase alphanumeric identifier"),
    name: z.string().describe("Human-readable title for the node UI"),
    type: z.literal("compute"),
    config: z
      .object({
        script: z
          .string()
          .describe("JavaScript expression or script to execute"),
        outputKey: z
          .string()
          .optional()
          .describe("State property where the output should be saved"),
      })
      .catchall(z.unknown()),
  }),
]);

const nextNodeProposalSchema = z.object({
  thought: z
    .string()
    .describe(
      "Brief chain-of-thought explaining what this specific step accomplishes towards the user objective",
    ),
  node: nodeProposalSchema,
  sourceNodeId: z
    .string()
    .describe(
      "ID of the node in the current graph that connects into this new node",
    ),
  edgeCondition: z
    .object({
      field: z.string().describe("State property to evaluate"),
      operator: z.enum([
        "equals",
        "not_equals",
        "greater_than",
        "greater_than_or_equals",
        "less_than",
        "less_than_or_equals",
        "contains",
        "not_contains",
        "starts_with",
        "ends_with",
        "is_empty",
        "is_not_empty",
        "in",
        "not_in",
        "regex_match",
      ]),
      value: z.unknown(),
    })
    .optional()
    .describe(
      "If this new node is part of a conditional branch from the source node, specify the condition required to traverse the edge to this node.",
    ),
  newStateProperties: z
    .record(z.string(), statePropertyDefinitionSchema)
    .optional()
    .describe(
      "Any new variables written by this node that need to be added to stateSchema",
    ),
  isFinalStepBeforeEnd: z
    .boolean()
    .describe(
      "True if this step completes the workflow objective and the next node should be End",
    ),
});

const updateNodeProposalSchema = z.object({
  thought: z
    .string()
    .describe("Brief explanation of the changes made to the node"),
  updatedNode: nodeProposalSchema,
  newStateProperties: z
    .record(z.string(), statePropertyDefinitionSchema)
    .optional()
    .describe("Any state properties added or modified for this node"),
});

export type IncrementalEvent =
  | {
      type: "node_added";
      node: GraphNode;
      edge?: GraphEdge;
      stateProperties?: Record<string, any>;
    }
  | {
      type: "node_updated";
      node: GraphNode;
      stateProperties?: Record<string, any>;
    }
  | {
      type: "planning";
      thoughts: string;
    };

/**
 * Incrementally generates a workflow graph node-by-node, yielding events
 * for each validated node and edge so the frontend can render them in real time.
 */
export async function* generateIncrementalGraph(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  currentGraph?: LangGraphAbstraction,
  targetNodeId?: string,
): AsyncGenerator<IncrementalEvent, LangGraphAbstraction, unknown> {
  const pluginNames = new Set(availablePlugins.map((p) => p.name));
  const llm = new ChatOllama({ model: modelName, temperature: 0.1 });

  // CASE 1: Updating a specific targeted node
  if (currentGraph && targetNodeId) {
    const existingNodeIndex = currentGraph.nodes.findIndex(
      (n) => n.id === targetNodeId,
    );
    if (existingNodeIndex === -1) {
      throw new Error(`Target node '${targetNodeId}' not found in graph.`);
    }

    const targetNode = currentGraph.nodes[existingNodeIndex];
    const updateLlm = llm.withStructuredOutput(updateNodeProposalSchema);

    const updateMessages = [
      new SystemMessage(`You are an Agentic AI Workflow Architect.
Your task is to update a specific node in an existing workflow according to user instructions.

Available plugins:
${JSON.stringify(availablePlugins, null, 2)}

Current Workflow State Schema:
${JSON.stringify(currentGraph.stateSchema, null, 2)}

Target Node to Update:
${JSON.stringify(targetNode, null, 2)}
`),
      new HumanMessage(
        `User instruction to update this node: "${prompt}".\nReturn the updated node configuration.`,
      ),
    ];

    const proposal = (await updateLlm.invoke(updateMessages)) as z.infer<
      typeof updateNodeProposalSchema
    >;

    yield {
      type: "planning",
      thoughts: proposal.thought,
    };

    // Update node in graph
    currentGraph.nodes[existingNodeIndex] = {
      ...proposal.updatedNode,
      id: targetNode.id,
      type: proposal.updatedNode.type as NodeType,
    };

    if (proposal.newStateProperties) {
      currentGraph.stateSchema = {
        ...currentGraph.stateSchema,
        ...proposal.newStateProperties,
      };
    }

    yield {
      type: "node_updated",
      node: currentGraph.nodes[existingNodeIndex],
      stateProperties: proposal.newStateProperties,
    };

    return currentGraph;
  }

  // CASE 2: Node-by-Node Incremental Graph Generation
  const graph: LangGraphAbstraction = currentGraph
    ? JSON.parse(JSON.stringify(currentGraph))
    : {
        nodes: [],
        edges: [],
        stateSchema: {
          input: {
            type: "string",
            description: "User initial query or prompt for this execution",
            required: true,
          },
        },
      };

  // If new graph, create and emit Start node first
  if (graph.nodes.length === 0) {
    const startNode: GraphNode = {
      id: "start",
      name: "Start",
      type: "start",
      config: {},
    };
    graph.nodes.push(startNode);
    yield {
      type: "node_added",
      node: startNode,
      stateProperties: graph.stateSchema,
    };
  }

  const stepLlm = llm.withStructuredOutput(nextNodeProposalSchema);
  const maxSteps = 8;
  let currentStep = 0;
  let lastNodeId = graph.nodes[graph.nodes.length - 1].id;

  const systemInstructions = `You are the Chief Architect of an Agentic AI System.
Your job is to construct an autonomous multi-step workflow incrementally, step by step.

Available Plugins:
${JSON.stringify(availablePlugins, null, 2)}

DESIGN PRINCIPLES:
1. Break down complex tasks into logical consecutive nodes.
   - For web investigations: (1) Web search query -> (2) Analyze/filter links -> (3) Read content -> (4) Synthesize report.
2. Node Types:
   - "llm": For analysis, reasoning, decision making, or final report writing. Config MUST define 'model' ("${modelName}"), 'temperature', 'systemPrompt', and 'outputKey'.
   - "plugin": To execute an external tool directly. Config MUST define 'pluginId', 'inputMapping', and 'outputKey'.
   - "compute": For simple data transformations. If branching logic is needed, DO NOT create a condition node. Instead, use 'edgeCondition' to set the requirement for entering the newly proposed node.
3. Every node must connect from an existing node ('sourceNodeId').
4. If a node outputs a new variable, you must declare it in 'newStateProperties' so it is added to the stateSchema.
5. When the user's objective is fully accomplished by the workflow, set 'isFinalStepBeforeEnd' to true.`;

  while (currentStep < maxSteps) {
    currentStep++;

    const stepMessages = [
      new SystemMessage(systemInstructions),
      new HumanMessage(`Overall User Objective: "${prompt}"

Current Graph State:
- Existing Nodes: ${JSON.stringify(
        graph.nodes.map((n) => ({ id: n.id, name: n.name, type: n.type })),
      )}
- Existing Edges: ${JSON.stringify(
        graph.edges.map((e) => ({ source: e.source, target: e.target })),
      )}
- Current State Schema Variables: ${JSON.stringify(Object.keys(graph.stateSchema))}
- Latest Node: "${lastNodeId}"

What is the next single logical step/node to build towards completing the user's objective?`),
    ];

    let proposal: z.infer<typeof nextNodeProposalSchema> | null = null;
    let attempts = 0;
    let validationError: string | null = null;

    while (attempts < 2) {
      attempts++;
      try {
        if (validationError) {
          stepMessages.push(
            new HumanMessage(
              `Your previous proposal had an error: ${validationError}. Please fix it and propose the step again.`,
            ),
          );
        }

        proposal = (await stepLlm.invoke(stepMessages)) as z.infer<
          typeof nextNodeProposalSchema
        >;

        if (!proposal.node || !proposal.node.id) {
          throw new Error("Missing node or node.id in proposal");
        }

        // Clean node ID
        let cleanId = proposal.node.id
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_");
        if (graph.nodes.some((n) => n.id === cleanId)) {
          cleanId = `${cleanId}_${currentStep}`;
        }
        proposal.node.id = cleanId;

        // Validate source exists
        let source = proposal.sourceNodeId;
        if (!graph.nodes.some((n) => n.id === source)) {
          source = lastNodeId;
        }

        // Validate plugin if plugin type
        if (proposal.node.type === "plugin") {
          const pId = proposal.node.config?.pluginId as string;
          if (!pId || !pluginNames.has(pId)) {
            // Fallback to llm node if plugin not found
            proposal.node = {
              id: proposal.node.id,
              name: proposal.node.name,
              type: "llm",
              config: {
                model: modelName,
                temperature: 0.1,
                systemPrompt: `Process the previous step and handle ${proposal.node.name}`,
                outputKey:
                  ((proposal.node.config as any)?.outputKey as string) ||
                  "output",
              },
            };
          }
        }

        validationError = null;
        break;
      } catch (err: any) {
        validationError = err.message || String(err);
      }
    }

    if (!proposal) {
      console.warn(
        `[Incremental Generator] Could not generate step ${currentStep}`,
      );
      break;
    }

    yield {
      type: "planning",
      thoughts: proposal.thought,
    };

    // Add state variables to graph stateSchema
    if (proposal.newStateProperties) {
      for (const [key, def] of Object.entries(proposal.newStateProperties)) {
        if (!graph.stateSchema[key]) {
          graph.stateSchema[key] = def as any;
        }
      }
    }

    // Add node
    const newNode: GraphNode = {
      id: proposal.node.id,
      name: proposal.node.name,
      type: proposal.node.type as NodeType,
      config: proposal.node.config,
    };
    graph.nodes.push(newNode);

    // Add edge
    const sourceNode =
      graph.nodes.find((n) => n.id === proposal?.sourceNodeId)?.id ||
      lastNodeId;
    const newEdge: GraphEdge = {
      id: `edge_${sourceNode}_${newNode.id}`,
      source: sourceNode,
      target: newNode.id,
      isConditional: !!proposal.edgeCondition,
      condition: proposal.edgeCondition,
    };
    graph.edges.push(newEdge);

    lastNodeId = newNode.id;

    // Emit event to stream
    yield {
      type: "node_added",
      node: newNode,
      edge: newEdge,
      stateProperties: proposal.newStateProperties,
    };

    if (proposal.isFinalStepBeforeEnd || currentStep >= maxSteps) {
      break;
    }
  }

  // Connect to End node
  const endNode: GraphNode = {
    id: "end",
    name: "End",
    type: "end",
    config: {},
  };
  graph.nodes.push(endNode);

  const endEdge: GraphEdge = {
    id: `edge_${lastNodeId}_end`,
    source: lastNodeId,
    target: "end",
    isConditional: false,
  };
  graph.edges.push(endEdge);

  yield {
    type: "node_added",
    node: endNode,
    edge: endEdge,
  };

  return graph;
}
