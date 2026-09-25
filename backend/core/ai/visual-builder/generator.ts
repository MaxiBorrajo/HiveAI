import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import {
  LangGraphAbstraction,
  GraphNode,
  GraphEdge,
  NodeType,
} from "./types.ts";
import { z } from "zod";

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

const edgeConditionSchema = z
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
  .describe("Condition required to traverse the edge.");

const plannerSchema = z.object({
  thought: z.string().describe("Your thought process for the next step."),
  action: z
    .enum([
      "create_plugin_node",
      "create_llm_node",
      "create_condition_node",
      "connect_existing_nodes",
      "finish",
    ])
    .describe("The next structural step"),
  sourceNodeId: z
    .string()
    .describe("Which existing node does this new step connect FROM?"),
  targetNodeId: z
    .string()
    .optional()
    .describe(
      "If action is connect_existing_nodes, which existing node does it connect TO?",
    ),
  conditionPath: z
    .enum(["true", "false"])
    .optional()
    .describe(
      "If source is a condition node, which path (true/false) is this connection for?",
    ),
});

const pluginConfigSchema = z.object({
  nodeId: z
    .string()
    .describe("Unique lowercase alphanumeric ID for this new node"),
  nodeName: z
    .string()
    .describe(
      "Beautiful human readable name (e.g. 'Search Google', 'Read Webpage')",
    ),
  pluginId: z
    .string()
    .describe("The EXACT id of the plugin to use from the provided list."),
  inputMapping: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Map plugin inputs to state memory variables (e.g. { query: 'input' })",
    ),
  outputKey: z
    .string()
    .optional()
    .describe("Memory key to save the plugin result"),
  edgeCondition: edgeConditionSchema.optional(),
  newStateProperties: z
    .record(z.string(), statePropertyDefinitionSchema)
    .optional()
    .describe("If outputKey is new, define its schema here"),
});

const llmConfigSchema = z.object({
  nodeId: z
    .string()
    .describe("Unique lowercase alphanumeric ID for this new node"),
  nodeName: z
    .string()
    .describe(
      "Beautiful human readable name (e.g. 'Search Google', 'Read Webpage')",
    ),
  pluginId: z
    .string()
    .describe("The EXACT id of the plugin to use from the provided list."),
  systemPrompt: z.string().describe("The prompt instructions for the LLM node"),
  outputKey: z
    .string()
    .optional()
    .describe("Memory key to save the LLM result"),
  edgeCondition: edgeConditionSchema.optional(),
  newStateProperties: z
    .record(z.string(), statePropertyDefinitionSchema)
    .optional()
    .describe("If outputKey is new, define its schema here"),
});

const conditionNodeSchema = z.object({
  nodeId: z
    .string()
    .describe("Unique lowercase alphanumeric ID for this condition node"),
  nodeName: z
    .string()
    .describe("Human readable name (e.g. Is Report Complete?)"),
  condition: z
    .object({
      field: z
        .string()
        .describe(
          "The exact state memory variable to check (e.g. 'is_complete')",
        ),
      operator: z
        .enum([
          "equals",
          "not_equals",
          "greater_than",
          "less_than",
          "contains",
          "is_empty",
          "is_not_empty",
        ])
        .describe("Comparison operator"),
      value: z
        .any()
        .describe("The static value to compare against (e.g. true, false, 5)"),
    })
    .describe("The exact logic rule for the True path."),
});

export type IncrementalEvent =
  | { type: "planning"; thoughts: string }
  | {
      type: "node_added";
      node: GraphNode;
      edge?: GraphEdge;
      stateProperties?: Record<string, any>;
    }
  | { type: "edge_added"; edge: GraphEdge };

export async function* generateIncrementalGraph(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  currentGraph?: LangGraphAbstraction,
  targetNodeId?: string,
): AsyncGenerator<IncrementalEvent, LangGraphAbstraction, unknown> {
  const pluginNames = new Set(availablePlugins.map((p) => p.name));

  const plannerLlm = new ChatOllama({
    model: modelName,
    temperature: 0.2,
  }).withStructuredOutput(plannerSchema, { name: "Planner" });
  const configLlm = new ChatOllama({ model: modelName, temperature: 0.05 });

  const pluginAgent = configLlm.withStructuredOutput(pluginConfigSchema, {
    name: "PluginConfig",
  });
  const llmAgent = configLlm.withStructuredOutput(llmConfigSchema, {
    name: "LLMConfig",
  });
  const conditionAgent = configLlm.withStructuredOutput(conditionNodeSchema, {
    name: "EdgeConfig",
  });

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

  let lastNodeId =
    targetNodeId ||
    (graph.nodes.length > 0 ? graph.nodes[graph.nodes.length - 1].id : null);

  if (!lastNodeId && graph.nodes.length === 0) {
    const startNode: GraphNode = {
      id: "start",
      name: "Start",
      type: "start",
      config: {},
    };
    graph.nodes.push(startNode);
    lastNodeId = "start";
    yield {
      type: "node_added",
      node: startNode,
    };
  }

  const maxSteps = 8;
  let currentStep = 0;

  const plannerInstructions = `You are the Router of an Agentic Workflow Builder.
Your job is ONLY to decide the NEXT structural step in the workflow to accomplish the User's Objective.

Available Plugins:
${availablePlugins.map((p) => `- ${p.name}: ${p.description}`).join("\\n")}

Rules:
1. "create_plugin_node": to execute a specific plugin tool.
2. "create_llm_node": to analyze, synthesize, or evaluate data using an LLM.
3. "create_condition_node": to create a decision diamond (if/else). You must specify the condition logic.
4. "connect_existing_nodes": to draw an edge between two existing nodes (e.g. for loops). You must provide 'targetNodeId'.
5. "finish": if the workflow has fully accomplished the user's objective.
6. If 'sourceNodeId' points to a condition node, you MUST specify 'conditionPath' ("true" or "false").
4. "connect_existing_nodes": to draw an edge between two existing nodes (e.g. for loops or convergence). You must provide 'targetNodeId'.
5. "finish": if the workflow has fully accomplished the user's objective AND all condition nodes have BOTH "true" and "false" paths connected.
6. MANDATORY FOR CONDITION NODES: Every single condition node MUST have TWO outgoing branches: one "true" path and one "false" path!
   - When connecting FROM a condition node, you MUST specify 'conditionPath' ("true" or "false").
   - You MUST define the "true" path (what to do if condition holds) AND the "false" path (alternative path or fallback).
   - Never leave a condition node with only one path!
7. DO NOT repeat identical nodes in a row. Use loops ("connect_existing_nodes") if repetitive work is needed based on condition paths.`;

  while (currentStep < maxSteps) {
    currentStep++;
    console.log(
      `\n[Visual Builder - Generator] --- Generating Step ${currentStep} of max ${maxSteps} ---`,
    );

    const conditionNodes = graph.nodes.filter((n) => n.type === "condition");
    const missingBranches: string[] = [];
    for (const cn of conditionNodes) {
      const edgesFromCn = graph.edges.filter((e) => e.source === cn.id);
      const hasTrue = edgesFromCn.some((e) => e.path === "true");
      const hasFalse = edgesFromCn.some((e) => e.path === "false");
      if (!hasTrue)
        missingBranches.push(`${cn.id} ("${cn.name}"): MISSING "true" branch`);
      if (!hasFalse)
        missingBranches.push(`${cn.id} ("${cn.name}"): MISSING "false" branch`);
    }

    const graphStateText = `Current Graph State:
- Existing Nodes:
${graph.nodes.length > 0 ? graph.nodes.map((n) => `  [${n.type}] ${n.id} ("${n.name}")`).join("\n") : "  (none)"}
- Existing Connections:
${graph.edges.length > 0 ? graph.edges.map((e) => `  ${e.source} ➔ ${e.target} ${e.path ? `[${e.path.toUpperCase()}]` : ""}`).join("\n") : "  (none)"}
- Current Memory Variables (State):
${
  Object.keys(graph.stateSchema).length > 0
    ? Object.entries(graph.stateSchema)
        .map(([k, v]) => `  - ${k} (${(v as any).type})`)
        .join("\n")
    : "  (none)"
}
- Latest Node Added: "${lastNodeId}"
${
  missingBranches.length > 0
    ? `- ⚠️ UNRESOLVED CONDITION BRANCHES (YOU MUST CONNECT THESE WITH conditionPath):\n${missingBranches.map((m) => `  * ${m}`).join("\n")}`
    : "- Condition Nodes Status: All condition branches are satisfied."
}`;

    const plannerMessages = [
      new SystemMessage(plannerInstructions),
      new HumanMessage(
        `Overall User Objective: "${prompt}"\n\n${graphStateText}\n\nWhat is the NEXT single structural action?`,
      ),
    ];

    let plan;
    try {
      console.log(`[Visual Builder - Generator] Invoking Planner LLM...`);
      plan = (await plannerLlm.invoke(plannerMessages)) as z.infer<
        typeof plannerSchema
      >;
    } catch (e: any) {
      console.warn(`[Visual Builder - Generator] Planner failed:`, e.message);
      break;
    }

    console.log(`[Visual Builder - Generator] Thought: "${plan.thought}"`);
    console.log(
      `[Visual Builder - Generator] Action: ${plan.action} (source: ${plan.sourceNodeId})`,
    );

    yield { type: "planning", thoughts: plan.thought };

    if (plan.action === "finish") {
      console.log(`[Visual Builder - Generator] Planner finished workflow.`);
      break;
    }

    let source = plan.sourceNodeId;
    if (!graph.nodes.some((n) => n.id === source)) {
      source = lastNodeId as string;
    }

    const builderMessages = [
      new SystemMessage(`You are a node Configurator. The Planner decided to do action: "${plan.action}" connected FROM source node "${source}". 
You must configure the details for this action accurately. 
Available Plugins:
${availablePlugins.map((p) => `- ${p.name}: ${p.description}`).join("\\n")}
Only output valid configuration values. If configuring a plugin, use an exact plugin name from the list. Use the Current Graph State to map inputs and schema correctly.`),
      new HumanMessage(
        `Overall User Objective: "${prompt}"\n\n${graphStateText}\n\nConfigure the ${plan.action} .`,
      ),
    ];

    try {
      if (plan.action === "create_plugin_node") {
        console.log(
          `[Visual Builder - Generator] Invoking Plugin Configurator...`,
        );
        const config = (await pluginAgent.invoke(builderMessages)) as z.infer<
          typeof pluginConfigSchema
        >;

        let cleanId = config.nodeId.toLowerCase().replace(/[^a-z0-9_]/g, "_");
        if (graph.nodes.some((n) => n.id === cleanId))
          cleanId = `${cleanId}_${currentStep}`;

        const newNode: GraphNode = {
          id: cleanId,
          name: config.nodeName,
          type: "plugin",
          config: {
            pluginId: config.pluginId,
            inputMapping: config.inputMapping,
            outputKey: config.outputKey,
          },
        };
        const newEdge: GraphEdge = {
          id: `edge_${source}_${cleanId}`,
          source: source,
          target: cleanId,
          isConditional: false,
          path: plan.conditionPath,
        };

        if (config.newStateProperties) {
          Object.assign(graph.stateSchema, config.newStateProperties);
        }

        graph.nodes.push(newNode);
        graph.edges.push(newEdge);
        lastNodeId = cleanId;

        yield {
          type: "node_added",
          node: newNode,
          edge: newEdge,
          stateProperties: config.newStateProperties,
        };
      } else if (plan.action === "create_llm_node") {
        const builderMessages = [
          new SystemMessage(`You are an LLM Node Configurator. The Planner decided to create an LLM node connected FROM source node "${source}".
Write a precise 'systemPrompt' instructing the LLM what to do. Use the Current Graph State to know what data will be available in memory.`),
          new HumanMessage(`Overall User Objective: "${prompt}"

${graphStateText}

Configure the LLM node.`),
        ];
        console.log(
          `[Visual Builder - Generator] Invoking LLM Configurator...`,
        );
        const config = (await llmAgent.invoke(builderMessages)) as z.infer<
          typeof llmConfigSchema
        >;

        let cleanId = config.nodeId.toLowerCase().replace(/[^a-z0-9_]/g, "_");
        if (graph.nodes.some((n) => n.id === cleanId))
          cleanId = `${cleanId}_${currentStep}`;

        const newNode: GraphNode = {
          id: cleanId,
          name: config.nodeName,
          type: "llm",
          config: {
            model: modelName,
            temperature: 0.1,
            systemPrompt: config.systemPrompt,
            outputKey: config.outputKey,
          },
        };
        const newEdge: GraphEdge = {
          id: `edge_${source}_${cleanId}`,
          source: source,
          target: cleanId,
          isConditional: false,
          path: plan.conditionPath,
        };

        if (config.newStateProperties) {
          Object.assign(graph.stateSchema, config.newStateProperties);
        }

        graph.nodes.push(newNode);
        graph.edges.push(newEdge);
        lastNodeId = cleanId;

        yield {
          type: "node_added",
          node: newNode,
          edge: newEdge,
          stateProperties: config.newStateProperties,
        };
      } else if (plan.action === "create_condition_node") {
        const builderMessages = [
          new SystemMessage(`You are a Condition Node Configurator. The Planner decided to create a decision node connected FROM source node "${source}".
You must define the exact 'condition' logic required for the TRUE path. The FALSE path will be the alternative.
Evaluate conditions using the memory variables defined in the Current Graph State.`),
          new HumanMessage(
            `Overall User Objective: "${prompt}"\n\n${graphStateText}\n\nConfigure the condition node.`,
          ),
        ];
        console.log(
          `[Visual Builder - Generator] Invoking Condition Configurator...`,
        );
        // Use withStructuredOutput on the original model
        const conditionAgent =
          configLlm.withStructuredOutput(conditionNodeSchema);
        const config = (await conditionAgent.invoke(
          builderMessages,
        )) as z.infer<typeof conditionNodeSchema>;

        let cleanId = config.nodeId.toLowerCase().replace(/[^a-z0-9_]/g, "_");
        if (graph.nodes.some((n) => n.id === cleanId))
          cleanId = `${cleanId}_${currentStep}`;

        const newNode: GraphNode = {
          id: cleanId,
          name: config.nodeName,
          type: "condition",
          config: {
            condition: config.condition,
          },
        };

        const newEdge: GraphEdge = {
          id: `edge_${source}_${cleanId}`,
          source: source,
          target: cleanId,
          isConditional: false,
          path: plan.conditionPath as any,
        };

        graph.nodes.push(newNode);
        graph.edges.push(newEdge);
        lastNodeId = cleanId;

        yield { type: "node_added", node: newNode, edge: newEdge };
      } else if (plan.action === "connect_existing_nodes") {
        let target = plan.targetNodeId;
        if (!target || !graph.nodes.some((n) => n.id === target)) {
          target = graph.nodes[0].id; // Fallback
        }

        const newEdge: GraphEdge = {
          id: `edge_${source}_${target}_loop`,
          source: source,
          target: target,
          isConditional: false,
          path: plan.conditionPath as any,
        };
        graph.edges.push(newEdge);
        lastNodeId = target;

        yield { type: "edge_added", edge: newEdge };
      }
    } catch (e: any) {
      console.warn(
        `[Visual Builder - Generator] Configurator failed:`,
        e.message,
      );
      break; // break the while loop if configurator fails hard
    }
  }

  // Connect to End node
  console.log(
    `[Visual Builder - Generator] Connecting workflow to 'End' node from "${lastNodeId}"`,
    `[Visual Builder - Generator] Connecting workflow to 'End' node`,
  );
  const endNode: GraphNode = {
    id: "end",
    name: "End",
    type: "end",
    config: {},
  };
  graph.nodes.push(endNode);

  const endEdge: GraphEdge = {
    id: `edge_${lastNodeId}_end`,
    source: lastNodeId as string,
    target: "end",
    isConditional: false,
  };
  graph.edges.push(endEdge);
  // If lastNodeId is not a condition node, connect it to end normally
  const lastNode = graph.nodes.find((n) => n.id === lastNodeId);
  if (lastNode && lastNode.type !== "condition" && lastNode.id !== "end") {
    if (
      !graph.edges.some((e) => e.source === lastNode.id && e.target === "end")
    ) {
      const endEdge: GraphEdge = {
        id: `edge_${lastNode.id}_end`,
        source: lastNode.id,
        target: "end",
        isConditional: false,
      };
      graph.edges.push(endEdge);
      yield { type: "edge_added", edge: endEdge };
    }
  }

  // MANDATORY ENFORCEMENT: Every condition node MUST have BOTH a "true" and a "false" branch
  for (const cn of graph.nodes.filter((n) => n.type === "condition")) {
    const edgesFromCn = graph.edges.filter((e) => e.source === cn.id);
    const hasTrue = edgesFromCn.some((e) => e.path === "true");
    const hasFalse = edgesFromCn.some((e) => e.path === "false");

    if (!hasTrue) {
      console.log(
        `[Visual Builder - Generator] Auto-connecting missing TRUE branch for condition "${cn.id}" ➔ end`,
      );
      const trueEdge: GraphEdge = {
        id: `edge_${cn.id}_end_true`,
        source: cn.id,
        target: "end",
        isConditional: false,
        path: "true",
      };
      graph.edges.push(trueEdge);
      yield { type: "edge_added", edge: trueEdge };
    }

    if (!hasFalse) {
      console.log(
        `[Visual Builder - Generator] Auto-connecting missing FALSE branch for condition "${cn.id}" ➔ end`,
      );
      const falseEdge: GraphEdge = {
        id: `edge_${cn.id}_end_false`,
        source: cn.id,
        target: "end",
        isConditional: false,
        path: "false",
      };
      graph.edges.push(falseEdge);
      yield { type: "edge_added", edge: falseEdge };
    }
  }

  console.log(
    `[Visual Builder - Generator] === Workflow Generation Complete ===`,
  );
  yield { type: "node_added", node: endNode };
  return graph;
}
