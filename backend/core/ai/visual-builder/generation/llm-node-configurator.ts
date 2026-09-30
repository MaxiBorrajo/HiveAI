import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  DataType,
  GraphEdge,
  GraphNode,
  LangGraphAbstraction,
  LlmConfig,
  LlmConfigCandidate,
  LlmNodeConfiguratorContext,
} from "../types.ts";
import { runConfigStep } from "./generation-step.ts";
import { normalizePluginName, PluginInfo } from "./topology-compiler.ts";
import {
  statePropertyDefinitionSchema,
  edgeConditionSchema,
} from "./node-config-schemas.ts";

export function buildLlmConfigSchema(
  availablePlugins: PluginInfo[],
  availableStateKeys: string[] = [],
) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const validKeys = availableStateKeys.filter((k) => k && k.trim().length > 0);
  const stateKeySchema =
    validKeys.length > 0
      ? z
          .enum(validKeys as [string, ...string[]])
          .describe(
            `Must be exactly one of the existing state variables: [${validKeys.join(", ")}]`,
          )
      : z.string().describe("Exact name of an existing state variable");

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this new node"),
    nodeName: z
      .string()
      .describe(
        "Beautiful human readable name (e.g. 'Synthesize Findings', 'Validate Criteria')",
      ),
    plugins: z
      .array(z.string())
      .optional()
      .describe(
        `Tools/plugins this LLM can invoke autonomously. Available: [${pluginNames.join(", ")}]`,
      ),
    pluginId: z.string().optional().describe("Optional plugin ID if needed"),
    systemPrompt: z
      .string()
      .describe("The prompt instructions for the LLM node"),
    outputKey: z
      .string()
      .optional()
      .describe(
        "Descriptive memory key for this node's output (e.g. 'summary_report', 'analysis', 'extracted_data', 'quality_score'). Avoid 'result' unless this is the final deliverable node!",
      ),
    inputMapping: z
      .record(z.string(), stateKeySchema)
      .optional()
      .describe(
        "Maps a descriptive label (shown to this node as its context header) to the BARE NAME (no '${}') of an existing state variable this node needs to read, e.g. { articles_to_compare: 'search_results' }. This REPLACES the full state dump at runtime — only what you declare here will be visible to this node.",
      ),
    edgeCondition: edgeConditionSchema.optional(),
    newStateProperties: z
      .record(z.string(), statePropertyDefinitionSchema)
      .optional()
      .describe("If outputKey is new, define its schema here"),
  });
}

function nodeFeedsIntoCondition(
  node: GraphNode,
  graph: LangGraphAbstraction,
): boolean {
  return graph.edges.some(
    (e) =>
      e.source === node.id &&
      graph.nodes.find((n) => n.id === e.target)?.type === "condition",
  );
}

function buildAgentToolHint(nodePlugins: string[]): string {
  if (nodePlugins.length === 0) return "";
  return `\nNOTE: This LLM node is an autonomous agent equipped with tools: [${nodePlugins.join(", ")}].
Instruct it in systemPrompt to use its tools iteratively (e.g. searching the web, reading multiple relevant URLs, extracting details, saving files) to compile a rich, thorough response before concluding.`;
}

function buildConditionPromptHint(feedsIntoCondition: boolean): string {
  if (!feedsIntoCondition) return "";
  return `\nCRITICAL: This LLM node feeds directly into a condition/decision node.
Choose the appropriate output type based on the user objective:
- If a numeric score, threshold, rating, or count is requested (e.g. score >= 7, rating > 80, count < 5): name 'outputKey' accordingly (e.g. 'score', 'rating', 'metric') and define it as 'number' in newStateProperties. Instruct the model to return ONLY the numeric score.
- If a category or status is requested (e.g. category equals 'security'): name 'outputKey' (e.g. 'category', 'status') and define it as 'string'.
- If a direct yes/no decision is requested: name 'outputKey' with an 'is_' prefix (e.g. 'is_approved', 'is_valid', 'is_critical') and define it as 'boolean'.`;
}

function buildBranchHint(incomingEdge: GraphEdge | undefined): string {
  if (!incomingEdge?.path) return "";
  return `\nWorkflow Path Context: This node executes on the '${incomingEdge.path}' branch from '${incomingEdge.source}'.`;
}

function buildLlmNodeSystemPrompt(
  node: GraphNode,
  nodeRole: string,
  feedsIntoCondition: boolean,
  hints: {
    branchHint: string;
    neighborHint: string;
    agentToolHint: string;
    conditionPromptHint: string;
  },
  graphStateText: string,
): string {
  const { branchHint, neighborHint, agentToolHint, conditionPromptHint } =
    hints;
  return `You are an LLM Node Configurator in an AI Workflow Visual Builder.
    Node Name: "${node.name}" (ID: "${node.id}")
    Specific Node Operational Role / Mission: "${nodeRole}"
    ${branchHint}
    ${neighborHint}
    ${agentToolHint}
    ${conditionPromptHint}
    ${graphStateText}

    CRITICAL INSTRUCTIONS:
    1. Configure the systemPrompt and memory outputKey SPECIFICALLY for THIS node's assigned mission: "${nodeRole}".
    2. ${
        feedsIntoCondition
          ? "This node evaluates a condition. Set outputKey to a decision metric (e.g. 'is_...' for boolean, 'score' for number)."
          : "This node does NOT evaluate a condition. It transforms, summarizes, generates, or drafts content. Its outputKey MUST NOT be a boolean decision flag like 'is_...' and MUST NOT overwrite previous decision variables in the State."
      }
    3. Read the Overall User Objective to understand the context, but fulfill ONLY this specific node's assigned mission ("${nodeRole}")!
    4. Populate "inputMapping" with EVERY state variable this node's mission actually needs to read (using the exact state variable names listed above, or a Predecessor's outputKey shown above) — this determines EXACTLY what data this node sees at runtime; a variable NOT listed here will be invisible to it. Do not list variables it doesn't need; do not omit ones it does.
    5. CRITICAL: In "systemPrompt", when you refer to data from "inputMapping", use ONLY the exact LABEL (the key you chose in inputMapping, e.g. if inputMapping is { "news_urls": "search_news_output" }, refer to it in systemPrompt as "news_urls" — NEVER as "search_news_output"). At runtime this node only sees its context blocks under the label names, not the underlying state variable names — mentioning the wrong name will make this node unable to find its own data.`;
}

function resolveInitialOutputKey(
  config: LlmConfigCandidate,
  node: GraphNode,
  intermediateNodes: GraphNode[],
): string {
  const outKey = config.outputKey || `${node.id}_output`;
  const isLastIntermediate =
    intermediateNodes[intermediateNodes.length - 1]?.id === node.id;
  return outKey === "result" && !isLastIntermediate
    ? `${node.id}_output`
    : outKey;
}


function inferOutputFieldType(
  outKey: string,
  config: LlmConfigCandidate,
): DataType {
  return config.newStateProperties?.[outKey]?.type || "string";
}


function reconcileOutputKeyWithConditionUsage(
  outKey: string,
  feedsIntoCondition: boolean,
  isBooleanField: boolean,
  graph: LangGraphAbstraction,
  node: GraphNode,
): string {
  if (feedsIntoCondition && isBooleanField && !outKey.startsWith("is_")) {
    return `is_${outKey.replace(/[^a-z0-9_]/g, "_")}`;
  }
  if (
    !feedsIntoCondition &&
    (outKey.startsWith("is_") || graph.stateSchema[outKey]?.type === "boolean")
  ) {
    return `${node.id}_output`;
  }
  return outKey;
}


function sanitizeNonBooleanSystemPrompt(
  promptText: string,
  isBooleanField: boolean,
  nodeRole: string,
): string {
  if (
    isBooleanField ||
    !/return (?:only )?(?:true|false|boolean)/i.test(promptText)
  ) {
    return promptText;
  }
  return `${promptText}\n\nCorrection: this node's output is not a boolean — ignore any instruction above to reply with only true/false/boolean. Instead, produce the actual content requested for this node's mission ("${nodeRole}") as a thorough, well-crafted response.`;
}


function resolveFinalPlugins(
  config: LlmConfigCandidate,
  nodePlugins: string[],
  availablePlugins: PluginInfo[],
  pluginNames: Set<string>,
): string[] | undefined {
  const rawPluginsList =
    config.plugins && config.plugins.length > 0 ? config.plugins : nodePlugins;

  const deduplicatedPlugins = Array.from(
    new Set(
      rawPluginsList
        .map((p) => normalizePluginName(p, availablePlugins))
        .filter((p): p is string => Boolean(p && pluginNames.has(p))),
    ),
  );

  return deduplicatedPlugins.length > 0 ? deduplicatedPlugins : undefined;
}


function buildFinalSystemPrompt(
  config: LlmConfigCandidate,
  promptText: string,
  feedsIntoCondition: boolean,
  isNumeric: boolean,
  isBooleanField: boolean,
): string {
  if (!feedsIntoCondition) return promptText;
  if (isNumeric)
    return `${config.systemPrompt}\nOutput only the numerical score/number without additional text.`;
  if (isBooleanField) {
    return `${config.systemPrompt}\nEvaluate the input carefully. Return a boolean: true if the condition is satisfied, false otherwise.`;
  }
  return config.systemPrompt;
}

function registerLlmOutputStateField(
  graph: LangGraphAbstraction,
  outKey: string,
  config: LlmConfigCandidate,
  node: GraphNode,
  feedsIntoCondition: boolean,
  isNumeric: boolean,
  isBooleanField: boolean,
): void {
  if (feedsIntoCondition) {
    graph.stateSchema[outKey] = {
      type: isNumeric ? "number" : isBooleanField ? "boolean" : "string",
      description: `Decision metric for ${node.name}`,
      required: false,
    };
  } else if (config.newStateProperties?.[outKey]) {
    graph.stateSchema[outKey] = config.newStateProperties[outKey];
  } else if (!graph.stateSchema[outKey]) {
    graph.stateSchema[outKey] = {
      type: isNumeric ? "number" : isBooleanField ? "boolean" : "string",
      description: `Output of ${node.name}`,
      required: false,
    };
  }
}

function applyLlmConfigCandidate(
  config: LlmConfigCandidate,
  node: GraphNode,
  nodeRole: string,
  feedsIntoCondition: boolean,
  ctx: LlmNodeConfiguratorContext,
  nodePlugins: string[],
): void {
  const { modelName, availablePlugins, pluginNames, graph, intermediateNodes } =
    ctx;

  let outKey = resolveInitialOutputKey(config, node, intermediateNodes);
  const fieldType = inferOutputFieldType(outKey, config);
  const isNumeric = fieldType === "number";
  const isBooleanField = fieldType === "boolean";

  outKey = reconcileOutputKeyWithConditionUsage(
    outKey,
    feedsIntoCondition,
    isBooleanField,
    graph,
    node,
  );

  const promptText = sanitizeNonBooleanSystemPrompt(
    config.systemPrompt,
    isBooleanField,
    nodeRole,
  );
  const finalPlugins = resolveFinalPlugins(config, nodePlugins, availablePlugins, pluginNames);

  const llmConfig: LlmConfig = {
    model: modelName,
    temperature: 0.1,
    systemPrompt: buildFinalSystemPrompt(
      config,
      promptText,
      feedsIntoCondition,
      isNumeric,
      isBooleanField,
    ),
    outputKey: outKey,
    ...(finalPlugins ? { plugins: finalPlugins } : {}),
    ...(config.inputMapping && Object.keys(config.inputMapping).length > 0
      ? { inputMapping: config.inputMapping }
      : {}),
    ...(feedsIntoCondition && isBooleanField
      ? { structuredOutput: { type: "boolean", required: true } }
      : feedsIntoCondition && isNumeric
        ? { structuredOutput: { type: "number", required: true } }
        : {}),
  };
  node.config = llmConfig;

  registerLlmOutputStateField(
    graph,
    outKey,
    config,
    node,
    feedsIntoCondition,
    isNumeric,
    isBooleanField,
  );
}

function applyFallbackLlmConfig(
  node: GraphNode,
  ctx: LlmNodeConfiguratorContext,
  feedsIntoCondition: boolean,
  nodePlugins: string[],
): void {
  const { modelName, graph, prompt } = ctx;

  console.warn(
    `[Visual Builder - Generator] LLM Config failed for ${node.id}, using deterministic fallback.`,
  );

  const finalPlugins = nodePlugins.length > 0 ? nodePlugins : undefined;
  const outKey = feedsIntoCondition
    ? `${node.id}_is_approved`
    : `${node.id}_result`;

  const llmConfig: LlmConfig = {
    model: modelName,
    temperature: 0.1,
    systemPrompt: feedsIntoCondition
      ? `Evaluate if the input meets the required criteria. Return true if approved/satisfied, or false otherwise.`
      : finalPlugins
        ? `You are an autonomous agent. Use your tools [${finalPlugins.join(", ")}] to accomplish the task: ${prompt}`
        : `Analyze and process the input for the task: ${prompt}`,
    outputKey: outKey,
    ...(finalPlugins ? { plugins: finalPlugins } : {}),
    ...(feedsIntoCondition
      ? { structuredOutput: { type: "boolean", required: true } }
      : {}),
  };
  node.config = llmConfig;

  graph.stateSchema[outKey] = {
    type: feedsIntoCondition ? "boolean" : "string",
    description: `Output of ${node.name}`,
    required: false,
  };
}

export async function configureLlmNode(
  node: GraphNode,
  ctx: LlmNodeConfiguratorContext,
): Promise<void> {
  const {
    prompt,
    availablePlugins,
    configLlm,
    graph,
    nodeDescriptions,
    neighborHint,
    graphStateText,
  } = ctx;

  const currentStateKeysForLlm = Object.keys(graph.stateSchema);
  const dynamicLlmConfigSchema = buildLlmConfigSchema(
    availablePlugins,
    currentStateKeysForLlm,
  );
  const llmAgent = configLlm.withStructuredOutput(dynamicLlmConfigSchema, {
    name: "LLMConfig",
  });

  const feedsIntoCondition = nodeFeedsIntoCondition(node, graph);
  const nodePlugins = (node.config.plugins as string[]) || [];
  const nodeRole = nodeDescriptions.get(node.id) || node.name;
  const incomingEdge = graph.edges.find((e) => e.target === node.id);

  const systemPrompt = buildLlmNodeSystemPrompt(
    node,
    nodeRole,
    feedsIntoCondition,
    {
      branchHint: buildBranchHint(incomingEdge),
      neighborHint,
      agentToolHint: buildAgentToolHint(nodePlugins),
      conditionPromptHint: buildConditionPromptHint(feedsIntoCondition),
    },
    graphStateText,
  );

  const builderMessages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(
      `Overall User Objective: "${prompt}"\n\nConfigure THIS node ("${node.name}", mission: "${nodeRole}").`,
    ),
  ];

  await runConfigStep<LlmConfigCandidate, void>({
    label: "LLM/Agent Node Configurator",
    agent: llmAgent,
    messages: builderMessages,
    onSuccess: (config) => {
      applyLlmConfigCandidate(
        config,
        node,
        nodeRole,
        feedsIntoCondition,
        ctx,
        nodePlugins,
      );
    },
    onFallback: () => {
      applyFallbackLlmConfig(node, ctx, feedsIntoCondition, nodePlugins);
    },
  });
}
