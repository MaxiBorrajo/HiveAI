import { ChatOllama } from "@langchain/ollama";
import { AIMessage, BaseMessage, SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  GraphNode,
  LangGraphAbstraction,
  PluginConfigCandidate,
  PluginInfo,
  PluginNodeConfiguratorContext,
} from "../types.ts";
import { runConfigStep } from "./generation-step.ts";
import { resolveOutputKey } from "./shared.ts";
import { normalizePluginName } from "./topology-compiler.ts";
import {
  statePropertyDefinitionSchema,
  edgeConditionSchema,
} from "./node-config-schemas.ts";

const templateRefSchema = z
  .string()
  .regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/)
  .describe('A "${varName}" template reference to a state variable');


function buildPluginParameterFieldSchemas(
  pluginDef: PluginInfo | undefined,
): Record<string, z.ZodTypeAny> | undefined {
  if (!pluginDef?.parameterSchema) return undefined;
  const fieldSchemas: Record<string, z.ZodTypeAny> = {};
  for (const [key, fieldSchema] of Object.entries(pluginDef.parameterSchema)) {
    fieldSchemas[key] = z.union([fieldSchema as z.ZodTypeAny, templateRefSchema]);
  }
  return fieldSchemas;
}

export function buildPluginConfigSchema(
  availablePlugins: PluginInfo[],
  selectedPluginDef?: PluginInfo,
) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const pluginEnum =
    pluginNames.length > 0
      ? z.enum(pluginNames as [string, ...string[]])
      : z.string();

  const fieldSchemas = buildPluginParameterFieldSchemas(selectedPluginDef);
  const inputMappingSchema: z.ZodTypeAny = fieldSchemas
    ? z.object(fieldSchemas).partial()
    : z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this node"),
    nodeName: z
      .string()
      .describe("Human readable name (e.g. 'Search Google', 'Save Alert Log')"),
    pluginId: pluginEnum.describe(
      `The plugin ID to use. Available: [${pluginNames.join(", ")}]. MUST be one of these exact names!`,
    ),
    inputMapping: inputMappingSchema
      .optional()
      .describe(
        "Map each of THIS plugin's real parameters to either a literal value of its EXACT declared type (e.g. a real number for a number parameter, NOT a quoted string), or a \"${varName}\" template reference to a state variable (e.g. '${cwd}', or the exact outputKey of an upstream node in this graph). NEVER reference '${result}' — it is not populated until the whole workflow finishes and no node in the graph produces it. NEVER wrap values in objects like { staticValue: ... } or { value: ... }!",
      ),
    outputKey: z
      .string()
      .optional()
      .describe(
        "Descriptive memory key for plugin output (e.g. 'system_metrics', 'file_content', 'search_data'). Avoid 'result' unless this is the final deliverable node!",
      ),
    edgeCondition: edgeConditionSchema.optional(),
    newStateProperties: z
      .record(z.string(), statePropertyDefinitionSchema)
      .optional()
      .describe("If outputKey is new, define its schema here"),
  });
}

function resolveInitialPlugin(
  node: GraphNode,
  availablePlugins: PluginInfo[],
  pluginNames: Set<string>,
): { assignedPluginId: string | undefined; pluginDef: PluginInfo | undefined } {
  const candidateId = node.config.pluginId as string | undefined;
  if (candidateId && pluginNames.has(candidateId)) {
    return {
      assignedPluginId: candidateId,
      pluginDef: availablePlugins.find((p) => p.name === candidateId),
    };
  }
  return { assignedPluginId: undefined, pluginDef: undefined };
}

function buildPluginSystemPrompt(
  node: GraphNode,
  nodeRole: string,
  pluginDef: PluginInfo | undefined,
  availablePlugins: PluginInfo[],
  pluginNames: Set<string>,
  neighborHint: string,
  graphStateText: string,
): string {
  const selectedPluginSection = pluginDef
    ? `Selected Plugin for this node: "${pluginDef.name}"
      Plugin Description: ${pluginDef.description || ""}
      Plugin Required & Optional Parameters:
      ${pluginDef.parametersDescription || "None"}${pluginDef.returnDescription ? `\nPlugin Output / Returns: ${pluginDef.returnDescription}` : ""}`
    : `No plugin has been pre-selected for this node — choose "pluginId" from the list above that best performs this node's role.`;

  return `You are a Plugin Node Configurator.
        Node Name: "${node.name}" (ID: "${node.id}")
        Node Operational Role / Purpose: "${nodeRole}"
        ${neighborHint}

        Available Plugins in the system and their parameter schemas:
        ${availablePlugins
          .map(
            (p) =>
              `- "${p.name}": ${p.description}\n  Parameters: ${p.parametersDescription || "None"}${p.returnDescription ? `\n  Returns: ${p.returnDescription}` : ""}`,
          )
          .join("\n\n")}

        ${selectedPluginSection}

        SYSTEM INVARIANTS:
        - Select and confirm "pluginId" from the available plugins [${Array.from(pluginNames).join(", ")}] that best performs this node's role: "${nodeRole}".
        - NEVER invent or hallucinate external tool names (like n8n, zapier, etc.)!

        HOST SYSTEM ENVIRONMENT:
        - Host Operating System: "${Deno.build.os}".
        - For command or script execution tools: You MUST generate commands fully compatible with ${Deno.build.os}!
        ${
          Deno.build.os === "linux"
            ? `  * Linux detected: Use standard Linux CLI utilities. NEVER use macOS-only commands like 'pmset', 'top -l 1', or 'vm_stat'!`
            : Deno.build.os === "darwin"
              ? `  * macOS detected: Use macOS CLI utilities.`
              : `  * Windows detected: Use Windows CLI utilities.`
        }

        CRITICAL RULES FOR inputMapping:
        1. You MUST provide values for all REQUIRED parameters of this plugin.
        2. Each parameter's value MUST match its REAL declared type (shown above under "Plugin Required & Optional Parameters") — if a parameter expects a number, provide a literal number (e.g. limit: 5, NOT limit: "5"); if it expects a boolean, provide a literal boolean; if it expects a string, provide a string. The ONLY exception is a "\${varName}" template reference (below), which is accepted regardless of the parameter's declared type.
          - For literal values: provide the raw value directly, in its correct type (e.g. command: "git status --short", operation: "write", path: "system_health.md", limit: 5).
          - For state memory references: use ONLY the exact template syntax "\${varName}", where varName is a single bare variable name with NO dots and NO brackets (e.g. "\${cwd}", "\${search_results}").
          - FORBIDDEN — NEVER write dot-path or bracket-index access such as "\${search_results.results[0].url}" or "\${search_results[1].url}". The runtime resolver treats everything inside "\${...}" as one flat literal key and does NOT walk into nested objects or arrays.
          - If you need a specific field out of a list/object (e.g. the URL of the top search result) rather than the whole variable, do NOT try to express that here. The upstream graph must already contain an "llm" node dedicated to extracting that single field into its own scalar outputKey (e.g. "top_result_url") — then reference that scalar here as "\${top_result_url}".
            * WRONG: inputMapping: { "url": "\${search_results.results[0].url}" }
            * RIGHT: upstream "llm" node with outputKey "top_result_url", then this node: inputMapping: { "url": "\${top_result_url}" }
          - NEVER wrap values in objects like { staticValue: ... } or { value: ... }!
          - For folder/directory/path parameters: if the User Objective does not give an explicit absolute path, use "\${cwd}" (the real host working directory, available in state). NEVER invent a plausible-looking absolute path like "/project/src" or "/home/user/docs" — that path does not exist on the host and will fail at runtime.
        3. Matching Specific Commands to Specialized Nodes:
          - When the user objective specifies multiple commands (e.g. chained with '&&', ';', or 'and') and the workflow decomposed them into separate specialized nodes (e.g. one node for "Git Status" and one for "Git Log"):
            Assign ONLY the specific sub-command matching THIS node's Operational Role!
            * For a Status inspection node: use ONLY the status command (e.g. "git status --short").
            * For a Log/history inspection node: use ONLY the log command (e.g. "git log -n 3 --oneline").
            * DO NOT copy the entire chained string into both nodes!
          - If there is only ONE plugin node in the workflow for multiple commands, then assign the full chained command.
        ${graphStateText}`;
}

function normalizeMappingValues(
  rawMapping: Record<string, any>,
): Record<string, any> {
  const mapping: Record<string, any> = {};
  for (const [k, v] of Object.entries(rawMapping)) {
    mapping[k] = v && typeof v === "object" && "value" in v ? v.value : v;
  }
  return mapping;
}

function resolveEffectivePluginId(
  config: PluginConfigCandidate,
  fallbackPluginId: string | undefined,
  availablePlugins: PluginInfo[],
  pluginNames: Set<string>,
): string {
  const normalized = config.pluginId
    ? normalizePluginName(config.pluginId, availablePlugins)
    : undefined;
  if (normalized && pluginNames.has(normalized)) return normalized;
  if (fallbackPluginId && pluginNames.has(fallbackPluginId)) return fallbackPluginId;
  return availablePlugins[0]?.name || "tool";
}


function validatePluginInputMapping(
  pluginDef: PluginInfo | undefined,
  inputMapping: Record<string, unknown>,
): string[] {
  const fieldSchemas = buildPluginParameterFieldSchemas(pluginDef);
  if (!fieldSchemas) return [];

  const requiredKeys = new Set(pluginDef?.requiredKeys || []);
  const shaped: Record<string, z.ZodTypeAny> = {};
  for (const [key, schema] of Object.entries(fieldSchemas)) {
    shaped[key] = requiredKeys.has(key) ? schema : schema.optional();
  }

  const result = z.object(shaped).safeParse(inputMapping);
  if (result.success) return [];

  return result.error.issues.map(
    (issue) => `parameter "${issue.path.join(".")}": ${issue.message}`,
  );
}

function fillMissingRequiredParams(
  inputMapping: Record<string, any>,
  pluginDef: PluginInfo | undefined,
): void {
  for (const reqKey of pluginDef?.requiredKeys || []) {
    if (inputMapping[reqKey] === undefined) {
      inputMapping[reqKey] = "${input}";
    }
  }
}

function registerPluginOutputStateField(
  graph: LangGraphAbstraction,
  outKey: string,
  config: PluginConfigCandidate,
  effectivePluginId: string,
): void {
  if (config.newStateProperties?.[outKey]) {
    graph.stateSchema[outKey] = config.newStateProperties[outKey];
  } else if (!graph.stateSchema[outKey]) {
    graph.stateSchema[outKey] = {
      type: "object",
      description: `Result from plugin ${effectivePluginId}`,
      required: false,
    };
  }
}

function resolveEffectivePlugin(
  config: PluginConfigCandidate,
  assignedPluginId: string | undefined,
  availablePlugins: PluginInfo[],
  pluginNames: Set<string>,
): { effectivePluginId: string; effectivePluginDef: PluginInfo | undefined } {
  const effectivePluginId = resolveEffectivePluginId(config, assignedPluginId, availablePlugins, pluginNames);
  const effectivePluginDef = availablePlugins.find((p: PluginInfo) => p.name === effectivePluginId);
  return { effectivePluginId, effectivePluginDef };
}

function finalizePluginConfig(
  node: GraphNode,
  ctx: PluginNodeConfiguratorContext,
  config: PluginConfigCandidate,
  effectivePluginId: string,
  inputMapping: Record<string, any>,
  usedFallback: boolean,
): { usedFallback: boolean } {
  const { graph, intermediateNodes } = ctx;
  const outKey = resolveOutputKey(node, config.outputKey, "_data", intermediateNodes);

  node.config = {
    pluginId: effectivePluginId,
    inputMapping,
    outputKey: outKey,
  };

  registerPluginOutputStateField(graph, outKey, config, effectivePluginId);

  return { usedFallback };
}

function applyFallbackPluginConfig(
  node: GraphNode,
  ctx: PluginNodeConfiguratorContext,
  assignedPluginId: string | undefined,
): { usedFallback: boolean } {
  const { availablePlugins } = ctx;

  console.warn(
    `[Visual Builder - Generator] Plugin Config failed for ${node.id}, using deterministic fallback.`,
  );

  const fallbackPluginId =
    assignedPluginId || availablePlugins[0]?.name || "tool";
  const fallbackPluginDef =
    availablePlugins.find((p: PluginInfo) => p.name === fallbackPluginId) ||
    availablePlugins[0];

  const inputMapping: Record<string, any> = {};
  fillMissingRequiredParams(inputMapping, fallbackPluginDef);

  node.config = {
    pluginId: fallbackPluginId,
    inputMapping,
    outputKey: `${node.id}_data`,
  };
  return { usedFallback: true };
}

const MAX_PLUGIN_RETRIES = 1;

export async function configurePluginNode(
  node: GraphNode,
  ctx: PluginNodeConfiguratorContext,
): Promise<{ usedFallback: boolean }> {
  const {
    prompt,
    availablePlugins,
    pluginNames,
    configLlm,
    nodeDescriptions,
    neighborHint,
    graphStateText,
  } = ctx;

  const { assignedPluginId, pluginDef } = resolveInitialPlugin(node, availablePlugins, pluginNames);

  const pluginConfigSchema = buildPluginConfigSchema(availablePlugins, pluginDef);
  const pluginAgent = configLlm.withStructuredOutput(pluginConfigSchema, {
    name: "PluginConfig",
  });

  const nodeRole = nodeDescriptions.get(node.id) || node.name;
  const messages: BaseMessage[] = [
    new SystemMessage(
      buildPluginSystemPrompt(node, nodeRole, pluginDef, availablePlugins, pluginNames, neighborHint, graphStateText),
    ),
    new HumanMessage(
      `Overall User Objective: "${prompt}"\nConfigure this plugin node specifically for its role: "${nodeRole}".`,
    ),
  ];

  for (let attempt = 1; attempt <= MAX_PLUGIN_RETRIES + 1; attempt++) {
    const step = await runConfigStep<
      PluginConfigCandidate,
      { config: PluginConfigCandidate | null; failed: boolean }
    >({
      label: "Plugin Node Configurator",
      agent: pluginAgent,
      messages,
      onSuccess: (config) => ({ config, failed: false }),
      onFallback: (err: unknown) => {
        console.warn(
          `[Visual Builder - Generator] Plugin Config LLM call failed for ${node.id} (attempt ${attempt}):`,
          err instanceof Error ? err.message : err,
        );
        return { config: null, failed: true };
      },
    });

    if (step.failed || !step.config) {
      return applyFallbackPluginConfig(node, ctx, assignedPluginId);
    }

    const { effectivePluginId, effectivePluginDef } = resolveEffectivePlugin(
      step.config,
      assignedPluginId,
      availablePlugins,
      pluginNames,
    );

    const rawMapping = (step.config.inputMapping || {}) as Record<string, any>;
    const inputMapping = normalizeMappingValues(rawMapping);

    const violations = validatePluginInputMapping(effectivePluginDef, inputMapping);
    if (violations.length === 0) {
      return finalizePluginConfig(node, ctx, step.config, effectivePluginId, inputMapping, false);
    }

    console.warn(
      `[Visual Builder - Generator] Plugin node ${node.id} attempt ${attempt} has an invalid inputMapping:`,
      violations,
    );

    if (attempt > MAX_PLUGIN_RETRIES) {
      fillMissingRequiredParams(inputMapping, effectivePluginDef);
      return finalizePluginConfig(node, ctx, step.config, effectivePluginId, inputMapping, true);
    }

    messages.push(
      new AIMessage(JSON.stringify(step.config)),
      new HumanMessage(
        `That inputMapping is invalid:\n${violations.map((v) => `- ${v}`).join("\n")}\nFix ALL of the issues above and answer again with a corrected inputMapping.`,
      ),
    );
  }

  return applyFallbackPluginConfig(node, ctx, assignedPluginId);
}
