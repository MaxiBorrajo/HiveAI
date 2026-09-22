import { ChatOllama } from "@langchain/ollama";
import {
  SystemMessage,
  HumanMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { StateGraph, START, END, StateGraphArgs } from "@langchain/langgraph";
import { LangGraphAbstraction } from "./types.ts";
import { z } from "zod";

// Zod schema to force the LLM to return exactly this structure
const statePropertyDefinitionSchema = z.object({
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string().optional(),
  default: z.any().optional(),
  reducerStrategy: z.enum(["overwrite", "append", "merge", "sum"]).optional(),
});

const nodeConfigSchema = z.record(z.string(), z.unknown());

const nodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["start", "end", "llm", "plugin", "condition"]),
  config: nodeConfigSchema,
});

const edgeSchema = z.object({
  source: z.string(),
  target: z.string().optional(),
  condition: z
    .object({
      variable: z.string(),
      operator: z.enum([
        "==",
        "!=",
        ">",
        "<",
        ">=",
        "<=",
        "contains",
        "exists",
      ]),
      value: z.any().optional(),
      targetNode: z.string(),
    })
    .optional(),
});

const langGraphAbstractionSchema = z.object({
  stateSchema: z.record(z.string(), statePropertyDefinitionSchema),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

export interface PluginInfo {
  name: string;
  description: string;
}

import { Annotation } from "@langchain/langgraph";
import { OllamaModelOptions } from "../../../modules/modes/utils/resolve-model-options.ts";

// 1. Define the internal state of our Generator Agent
export const GeneratorStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
    default: () => [],
  }),
  attempts: Annotation<number>({
    reducer: (x: number, y: number | undefined) => (y !== undefined ? y : x),
    default: () => 0,
  }),
  draftGraph: Annotation<LangGraphAbstraction | null>({
    reducer: (x: LangGraphAbstraction | null, y: LangGraphAbstraction | null) =>
      y,
    default: () => null,
  }),
  validationError: Annotation<string | null>({
    reducer: (x: string | null, y: string | null) => y,
    default: () => null,
  }),
  modelName: Annotation<string>({
    reducer: (x: string, y: string) => x,
  }),
  availablePlugins: Annotation<PluginInfo[]>({
    reducer: (x: PluginInfo[], y: PluginInfo[]) => x,
    default: () => [],
  }),
});

type GeneratorState = typeof GeneratorStateAnnotation.State;

// 2. Node 1: The LLM Generator
async function generateNode(
  state: GeneratorState,
): Promise<Partial<GeneratorState>> {
  const llm = new ChatOllama({ model: state.modelName, temperature: 0.1 });
  const structuredLlm = llm.withStructuredOutput(langGraphAbstractionSchema);

  console.log(
    `[Generator Agent] Attempt ${state.attempts + 1}: Requesting design from LLM...`,
  );

  try {
    const draft = await structuredLlm.invoke(state.messages);
    return {
      draftGraph: draft as unknown as LangGraphAbstraction,
      attempts: state.attempts + 1,
    };
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      validationError: `Critical failure in the model's structured output: ${err}`,
      attempts: state.attempts + 1,
    };
  }
}

// 3. Node 2: The Architectural Validator
async function validateNode(
  state: GeneratorState,
): Promise<Partial<GeneratorState>> {
  if (!state.draftGraph) return {};

  try {
    validateGraphArchitecture(state.draftGraph, state.availablePlugins);
    console.log(`[Generator Agent] Validation successful.`);
    return { validationError: null };
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.warn(`[Generator Agent] Validation failed: ${errorMsg}`);

    // If it fails, we add the error to the history so the LLM reads it on the next attempt
    return {
      validationError: errorMsg,
      messages: [
        new HumanMessage(
          `Your design failed the internal validation with this error:\n${errorMsg}\n\nPlease fix the JSON and regenerate it.`,
        ),
      ],
    };
  }
}

// 4. Routing condition
function routeAfterValidation(state: GeneratorState): "generate" | typeof END {
  if (state.validationError && state.attempts < 3) {
    return "generate"; // Retry
  }
  return END; // End if successful or out of attempts
}

// 5. Assemble the Generator Agent Graph
const generatorWorkflow = new StateGraph(GeneratorStateAnnotation)
  .addNode("generate", generateNode)
  .addNode("validate", validateNode)
  .addEdge(START, "generate")
  .addEdge("generate", "validate")
  .addConditionalEdges("validate", routeAfterValidation);

const compiledGenerator = generatorWorkflow.compile();

export async function generateGraphFromPrompt(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  currentGraph?: LangGraphAbstraction,
): Promise<LangGraphAbstraction> {
  const systemPrompt = `You are the Chief Architect of an Agentic AI System.
    Your goal is to design a workflow (Graph) in JSON format that solves the user's request.

    Available plugins in the system:
    ${JSON.stringify(availablePlugins, null, 2)}

    STRICT DESIGN RULES:
    1. You must always include a node with id "start" and type "start".
    2. You must always include a node with id "end" and type "end".
    3. For logical decisions, use a node type "condition", reading a variable from the state.
    4. The "stateSchema" must define all the variables that the nodes will share.
    5. CRITICAL: The "stateSchema" MUST always include a property named "input" of type "string". This represents the user's initial prompt or query for the execution.
    6. DO NOT invent plugin names that are not in the list.
    7. If an LLM node needs to use plugins, add them to its "config.plugins" array.
    8. If the prompt is very simple (1 step), generate a minimalist graph of Start -> LLM -> End.
    9. For LLM nodes, YOU MUST define their 'config': specify 'model' (e.g., "${modelName}"), 'temperature' (0.0 to 1.0), and a detailed 'systemPrompt'. If the LLM should output structured data, define 'structuredOutput' mapping to a state property, and always set 'outputKey' indicating where the result should be saved in the state.`;

  const userMessage = currentGraph
    ? `Here is the current workflow design:\n${JSON.stringify(currentGraph, null, 2)}\n\nThe user wants to modify it: ${prompt}\n\nPlease generate the updated JSON workflow, retaining all unchanged parts.`
    : `Design a workflow to solve this: ${prompt}`;

  const initialState = {
    messages: [new SystemMessage(systemPrompt), new HumanMessage(userMessage)],
    attempts: 0,
    draftGraph: null,
    validationError: null,
    modelName,
    availablePlugins,
  };

  const finalState = (await compiledGenerator.invoke(initialState)) as Record<
    string,
    any
  >;

  if (finalState.validationError || !finalState.draftGraph) {
    throw new Error(
      `[Generator] Failed after ${finalState.attempts} attempts. Last error: ${finalState.validationError}`,
    );
  }

  return finalState.draftGraph as LangGraphAbstraction;
}

/**
 * Pure function to validate that the Graph is mathematically executable
 * before returning it to the Frontend to be rendered or saved.
 */
function validateGraphArchitecture(graph: any, availablePlugins: PluginInfo[]) {
  const nodeIds = new Set<string>();
  let startCount = 0;
  let endCount = 0;

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(
        `Duplicate node ID found: '${node.id}'. All node IDs must be unique.`,
      );
    }
    nodeIds.add(node.id);

    if (node.type === "start") startCount++;
    if (node.type === "end") endCount++;
  }

  const pluginNames = new Set(availablePlugins.map((p) => p.name));

  // 1. Validate Start and End
  if (startCount !== 1)
    throw new Error(
      `The graph must have exactly one node of type 'start'. Found: ${startCount}`,
    );
  if (endCount !== 1)
    throw new Error(
      `The graph must have exactly one node of type 'end'. Found: ${endCount}`,
    );
  if (!nodeIds.has("start"))
    throw new Error(`The graph must have a node with id 'start'.`);
  if (!nodeIds.has("end"))
    throw new Error(`The graph must have a node with id 'end'.`);

  // 2. Validate Edges and Orphan Nodes
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      throw new Error(
        `The edge references a source '${edge.source}' that does not exist.`,
      );
    }
    if (edge.target && !nodeIds.has(edge.target)) {
      throw new Error(
        `The edge references a target '${edge.target}' that does not exist.`,
      );
    }
    if (edge.condition && !nodeIds.has(edge.condition.targetNode)) {
      throw new Error(
        `An edge's condition references a targetNode '${edge.condition.targetNode}' that does not exist.`,
      );
    }
  }

  // 3. Validate Plugins
  for (const node of graph.nodes) {
    if (node.type === "plugin") {
      const requestedPlugin = node.config?.pluginId;
      if (!requestedPlugin || !pluginNames.has(requestedPlugin)) {
        throw new Error(
          `Node '${node.id}' attempts to use plugin '${requestedPlugin}', which is not installed. Valid options: ${Array.from(pluginNames).join(", ")}`,
        );
      }
    }
    if (
      node.type === "llm" &&
      node.config?.plugins &&
      Array.isArray(node.config.plugins)
    ) {
      for (const p of node.config.plugins) {
        if (!pluginNames.has(p)) {
          throw new Error(
            `LLM node '${node.id}' attempts to inject tool '${p}', which is not installed.`,
          );
        }
      }
    }
  }

  // 4. Validate State Schema requirements
  if (!graph.stateSchema || typeof graph.stateSchema !== "object") {
    throw new Error("The graph must define a valid 'stateSchema' object.");
  }
  if (!("input" in graph.stateSchema)) {
    throw new Error(
      "The 'stateSchema' MUST define a property named 'input'. This is the required universal entry point provided by the user.",
    );
  }
  if (graph.stateSchema["input"].type !== "string") {
    throw new Error(
      "The 'input' property in 'stateSchema' MUST be of type 'string'.",
    );
  }
}
