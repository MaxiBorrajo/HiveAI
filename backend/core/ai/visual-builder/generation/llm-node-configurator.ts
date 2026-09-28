import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { GraphNode, LangGraphAbstraction, LlmConfig } from "../types.ts";
import { runConfigStep } from "./generation-step.ts";
import { normalizePluginName, PluginInfo } from "./topology-compiler.ts";
import { statePropertyDefinitionSchema, edgeConditionSchema } from "./node-config-schemas.ts";

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
    systemPrompt: z.string().describe("The prompt instructions for the LLM node"),
    outputKey: z
      .string()
      .optional()
      .describe("Descriptive memory key for this node's output (e.g. 'summary_report', 'analysis', 'extracted_data', 'quality_score'). Avoid 'result' unless this is the final deliverable node!"),
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

export interface LlmNodeConfiguratorContext {
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
}

/**
 * Phase 2, "llm" node branch: configures systemPrompt/outputKey/plugins for
 * an LLM node via a structured-output call, with normalization of the
 * decision-metric naming/typing when this node feeds a condition, and a
 * manual heuristic fallback config if the call fails.
 */
export async function configureLlmNode(
  node: GraphNode,
  ctx: LlmNodeConfiguratorContext,
): Promise<void> {
  const { prompt, modelName, availablePlugins, pluginNames, configLlm, graph, intermediateNodes, nodeDescriptions, neighborHint, graphStateText } = ctx;

  // Rebuilt per-node so inputMapping's value enum reflects the CURRENT
  // graph.stateSchema keys at the moment THIS node is configured (same
  // pattern buildConditionNodeSchema uses for condition nodes below).
  const currentStateKeysForLlm = Object.keys(graph.stateSchema);
  const dynamicLlmConfigSchema = buildLlmConfigSchema(
    availablePlugins,
    currentStateKeysForLlm,
  );
  const llmAgent = configLlm.withStructuredOutput(dynamicLlmConfigSchema, {
    name: "LLMConfig",
  });

  // Check if this LLM feeds directly into a condition node
  const feedsIntoCondition = graph.edges.some(
    (e) =>
      e.source === node.id &&
      graph.nodes.find((n) => n.id === e.target)?.type === "condition",
  );

  const nodePlugins = (node.config.plugins as string[]) || [];
  const agentToolHint =
    nodePlugins.length > 0
      ? `\nNOTE: This LLM node is an autonomous agent equipped with tools: [${nodePlugins.join(", ")}].
Instruct it in systemPrompt to use its tools iteratively (e.g. searching the web, reading multiple relevant URLs, extracting details, saving files) to compile a rich, thorough response before concluding.`
      : "";

  const conditionPromptHint = feedsIntoCondition
    ? `\nCRITICAL: This LLM node feeds directly into a condition/decision node.
Choose the appropriate output type based on the user objective:
- If a numeric score, threshold, rating, or count is requested (e.g. score >= 7, rating > 80, count < 5): name 'outputKey' accordingly (e.g. 'score', 'rating', 'metric') and define it as 'number' in newStateProperties. Instruct the model to return ONLY the numeric score.
- If a category or status is requested (e.g. category equals 'security'): name 'outputKey' (e.g. 'category', 'status') and define it as 'string'.
- If a direct yes/no decision is requested: name 'outputKey' with an 'is_' prefix (e.g. 'is_approved', 'is_valid', 'is_critical') and define it as 'boolean'.`
    : "";

  const nodeRole = nodeDescriptions.get(node.id) || node.name;
  const incomingEdge = graph.edges.find((e) => e.target === node.id);
  const branchHint = incomingEdge?.path
    ? `\nWorkflow Path Context: This node executes on the '${incomingEdge.path}' branch from '${incomingEdge.source}'.`
    : "";

  const builderMessages = [
    new SystemMessage(`You are an LLM Node Configurator in an AI Workflow Visual Builder.
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
5. CRITICAL: In "systemPrompt", when you refer to data from "inputMapping", use ONLY the exact LABEL (the key you chose in inputMapping, e.g. if inputMapping is { "news_urls": "search_news_output" }, refer to it in systemPrompt as "news_urls" — NEVER as "search_news_output"). At runtime this node only sees its context blocks under the label names, not the underlying state variable names — mentioning the wrong name will make this node unable to find its own data.`),
    new HumanMessage(
      `Overall User Objective: "${prompt}"\n\nConfigure THIS node ("${node.name}", mission: "${nodeRole}").`,
    ),
  ];

  await runConfigStep<z.infer<ReturnType<typeof buildLlmConfigSchema>>, void>({
    label: "LLM/Agent Node Configurator",
    agent: llmAgent,
    messages: builderMessages,
    onSuccess: (config) => {
      let outKey = config.outputKey || `${node.id}_output`;
      const isLastIntermediate =
        intermediateNodes[intermediateNodes.length - 1]?.id === node.id;
      if (outKey === "result" && !isLastIntermediate) {
        outKey = `${node.id}_output`;
      }

      const requestedType =
        config.newStateProperties?.[outKey]?.type ||
        (/score|count|rating|level|number|metric|percentage/i.test(outKey)
          ? "number"
          : /category|classification|sentiment|status/i.test(outKey)
            ? "string"
            : outKey.startsWith("is_") || outKey.endsWith("_valid") || outKey.endsWith("_approved") || outKey.endsWith("_flag")
              ? "boolean"
              : "string");

      const isNumeric = requestedType === "number";
      const isBooleanField = requestedType === "boolean";

      if (feedsIntoCondition && isBooleanField && !outKey.startsWith("is_")) {
        outKey = `is_${outKey.replace(/[^a-z0-9_]/g, "_")}`;
      } else if (!feedsIntoCondition) {
        // If this LLM node does NOT feed into a condition, it MUST NOT output a boolean flag or overwrite existing decision keys!
        if (outKey.startsWith("is_") || (graph.stateSchema[outKey] && graph.stateSchema[outKey].type === "boolean")) {
          outKey = `${node.id}_output`;
        }
      }

      let promptText = config.systemPrompt;
      if (!feedsIntoCondition && /return (?:only )?(?:true|false|boolean)/i.test(promptText)) {
        promptText = `You are a helpful AI assistant. Your mission is: ${nodeRole}.\nRead the input and relevant context from memory, and fulfill the requested task with a thorough, well-crafted response.`;
      }

      // Check if there are other plugin nodes in the graph that already execute tools
      const hasExternalPluginNodes = intermediateNodes.some((n) => n.type === "plugin");
      const isCodingOrDraftingNode = /write|generat|draft|summariz|classif|translat|cod/i.test(node.id) || /write|generat|draft|summariz|classif|translat|cod/i.test(nodeRole);

      const rawPluginsList =
        config.plugins && config.plugins.length > 0
          ? config.plugins
          : nodePlugins;

      const deduplicatedPlugins = Array.from(
        new Set(
          rawPluginsList
            .map((p) => normalizePluginName(p, availablePlugins))
            .filter((p): p is string => Boolean(p && pluginNames.has(p))),
        ),
      );

      // If the graph already has dedicated plugin nodes and this LLM node's
      // role is purely to write/generate code or text, it does NOT need external
      // tools bound — UNLESS it was already seeded with tools (an agent-equipped
      // node with zero tools would be invalid), in which case keep them.
      const finalPlugins =
        hasExternalPluginNodes && isCodingOrDraftingNode && nodePlugins.length === 0
          ? undefined
          : deduplicatedPlugins.length > 0
            ? deduplicatedPlugins
            : undefined;

      const llmConfig: LlmConfig = {
        model: modelName,
        temperature: 0.1,
        systemPrompt: feedsIntoCondition
          ? isNumeric
            ? `${config.systemPrompt}\nOutput only the numerical score/number without additional text.`
            : isBooleanField
              ? `${config.systemPrompt}\nEvaluate the input carefully. Return a boolean: true if the condition is satisfied, false otherwise.`
              : config.systemPrompt
          : promptText,
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

      if (feedsIntoCondition) {
        graph.stateSchema[outKey] = {
          type: isNumeric ? "number" : isBooleanField ? "boolean" : "string",
          description: `Decision metric for ${node.name}`,
          required: false,
        };
      } else if (config.newStateProperties?.[outKey]) {
        // Only accept the schema entry for THIS node's own outKey — the LLM
        // sometimes throws in extra unrelated keys here, which would
        // otherwise pollute graph.stateSchema with names no node actually
        // produces (they'd then look "valid" to downstream inputMapping
        // enums, which are built from graph.stateSchema keys).
        graph.stateSchema[outKey] = config.newStateProperties[outKey];
      } else if (!graph.stateSchema[outKey]) {
        graph.stateSchema[outKey] = {
          type: isNumeric ? "number" : isBooleanField ? "boolean" : "string",
          description: `Output of ${node.name}`,
          required: false,
        };
      }
    },
    onFallback: (err: any) => {
      console.warn(
        `[Visual Builder - Generator] LLM Config failed for ${node.id}:`,
        err?.message,
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
    },
  });
}
