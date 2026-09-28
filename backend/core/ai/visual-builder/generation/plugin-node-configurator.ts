import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { GraphNode, LangGraphAbstraction } from "../types.ts";
import { runConfigStep } from "./generation-step.ts";
import { normalizePluginName, PluginInfo } from "./topology-compiler.ts";
import { statePropertyDefinitionSchema, edgeConditionSchema } from "./node-config-schemas.ts";

/**
 * Dynamic Zod schema for configuring a Plugin node.
 * Allows inputMapping to contain both state variable references and static literals.
 */
// "${varName}" only — a template reference resolved at runtime, accepted
// regardless of the parameter's declared type (the referenced state
// variable could hold any type at that point).
const templateRefSchema = z
  .string()
  .regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/)
  .describe('A "${varName}" template reference to a state variable');

export function buildPluginConfigSchema(
  availablePlugins: PluginInfo[],
  selectedPluginDef?: PluginInfo,
) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const pluginEnum =
    pluginNames.length > 0
      ? z.enum(pluginNames as [string, ...string[]])
      : z.string();

  // If we know the real plugin for this node, build inputMapping's value
  // schema PER FIELD from its actual Zod types — a number field only
  // accepts a real number literal or a "${varName}" template string, never
  // a bare string like "5" for a field that expects a real number.
  let inputMappingSchema: z.ZodTypeAny;
  if (selectedPluginDef?.parameterSchema) {
    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    for (const [key, fieldSchema] of Object.entries(
      selectedPluginDef.parameterSchema,
    )) {
      fieldSchemas[key] = z.union([fieldSchema, templateRefSchema]);
    }
    inputMappingSchema = z.object(fieldSchemas).partial();
  } else {
    // Fallback: no known plugin shape — keep the generic union.
    inputMappingSchema = z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    );
  }

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this node"),
    nodeName: z
      .string()
      .describe("Human readable name (e.g. 'Search Google', 'Save Alert Log')"),
    pluginId: pluginEnum
      .describe(
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
      .describe("Descriptive memory key for plugin output (e.g. 'system_metrics', 'file_content', 'search_data'). Avoid 'result' unless this is the final deliverable node!"),
    edgeCondition: edgeConditionSchema.optional(),
    newStateProperties: z
      .record(z.string(), statePropertyDefinitionSchema)
      .optional()
      .describe("If outputKey is new, define its schema here"),
  });
}

export interface PluginNodeConfiguratorContext {
  prompt: string;
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
 * Phase 2, "plugin" node branch: resolves the selected plugin, configures
 * its inputMapping/outputKey via a structured-output call, applies the
 * schema-driven generic parameter auto-completion for common parameter
 * shapes (path/content/operation/command/cwd/url/query), and falls back to
 * a manual heuristic mapping if the call fails. Returns whether the
 * fallback path was used (the caller yields "node_updated" without
 * `stateProperties` in that case, matching the pre-refactor behavior).
 */
export async function configurePluginNode(
  node: GraphNode,
  ctx: PluginNodeConfiguratorContext,
): Promise<{ usedFallback: boolean }> {
  const { prompt, availablePlugins, pluginNames, configLlm, graph, intermediateNodes, nodeDescriptions, neighborHint, graphStateText } = ctx;

  let selectedPluginId = (node.config.pluginId as string);
  if (!selectedPluginId || !pluginNames.has(selectedPluginId)) {
    selectedPluginId = availablePlugins[0]?.name || "tool";
  }
  const pluginDef = availablePlugins.find((p) => p.name === selectedPluginId) || availablePlugins[0];

  const pluginConfigSchema = buildPluginConfigSchema(availablePlugins, pluginDef);
  const pluginAgent = configLlm.withStructuredOutput(pluginConfigSchema, {
    name: "PluginConfig",
  });

  const nodeRole = nodeDescriptions.get(node.id) || node.name;
  const builderMessages = [
    new SystemMessage(`You are a Plugin Node Configurator.
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

Selected Plugin for this node: "${pluginDef.name}"
Plugin Description: ${pluginDef.description || ""}
Plugin Required & Optional Parameters:
${pluginDef.parametersDescription || "None"}${pluginDef.returnDescription ? `\nPlugin Output / Returns: ${pluginDef.returnDescription}` : ""}

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
${graphStateText}`),
    new HumanMessage(
      `Overall User Objective: "${prompt}"\nConfigure this plugin node specifically for its role: "${nodeRole}".`,
    ),
  ];

  return runConfigStep<z.infer<ReturnType<typeof buildPluginConfigSchema>>, { usedFallback: boolean }>({
    label: "Plugin Node Configurator",
    agent: pluginAgent,
    messages: builderMessages,
    onSuccess: (config) => {
      let outKey = config.outputKey || `${node.id}_data`;
      const isLastIntermediate =
        intermediateNodes[intermediateNodes.length - 1]?.id === node.id;
      if (outKey === "result" && !isLastIntermediate) {
        outKey = `${node.id}_data`;
      }

      let effectivePluginId = selectedPluginId;
      if (config.pluginId) {
        const normalized = normalizePluginName(config.pluginId, availablePlugins);
        if (normalized && pluginNames.has(normalized)) {
          effectivePluginId = normalized;
        }
      }
      if (!pluginNames.has(effectivePluginId)) {
        effectivePluginId = availablePlugins[0]?.name || "tool";
      }

      const rawMapping = (config.inputMapping || {}) as Record<string, any>;
      const inputMapping: Record<string, any> = {};
      for (const [k, v] of Object.entries(rawMapping)) {
        if (v && typeof v === "object" && "value" in v) {
          inputMapping[k] = (v as any).value;
        } else {
          inputMapping[k] = v;
        }
      }

      // === SCHEMA-DRIVEN GENERIC PARAMETER AUTO-COMPLETION ===
      const expectedKeys = new Set([
        ...(pluginDef.parameterKeys || []),
        ...Object.keys(rawMapping),
      ]);
      const hasParam = (pattern: RegExp) =>
        Array.from(expectedKeys).find((k) => pattern.test(k));

      // 1. Path / File parameter (e.g. path, file, filename, filePath)
      const pathKey = hasParam(/^(?:path|file|filename|filePath)$/i);
      if (pathKey) {
        if (!inputMapping[pathKey]) {
          const fileMatch = prompt.match(
            /['"]?([a-zA-Z0-9_\-\.\/]+\.(?:log|md|json|txt|js|ts|py|html|sh))['"]?/i,
          );
          inputMapping[pathKey] = fileMatch ? fileMatch[1] : "${cwd}";
        }
        if (
          typeof inputMapping[pathKey] === "string" &&
          inputMapping[pathKey].startsWith("/") &&
          !inputMapping[pathKey].startsWith("/home/") &&
          !inputMapping[pathKey].startsWith("/tmp/") &&
          !inputMapping[pathKey].startsWith("/var/")
        ) {
          inputMapping[pathKey] = inputMapping[pathKey].replace(/^\/+/, "");
        }
      }

      // 2. Content / Data / Body / Text parameter
      const contentKey = hasParam(/^(?:content|data|body|text|payload|message)$/i);
      if (contentKey && !inputMapping[contentKey]) {
        const incomingEdge = graph.edges.find((e) => e.target === node.id);
        const sourceNode = incomingEdge
          ? graph.nodes.find((n) => n.id === incomingEdge.source)
          : null;
        const sourceOutKey =
          (sourceNode?.config?.outputKey as string) ||
          Object.keys(graph.stateSchema).find((k) => k !== "input") ||
          "input";
        inputMapping[contentKey] = sourceOutKey;
      }

      // 3. Operation / Action parameter
      const opKey = hasParam(/^(?:operation|action|mode|method)$/i);
      if (opKey && !inputMapping[opKey]) {
        inputMapping[opKey] = "write";
      }

      // 4. Command / Script parameter
      const cmdKey = hasParam(/^(?:command|cmd|script)$/i);
      if (cmdKey) {
        let cmd = typeof inputMapping[cmdKey] === "string" ? inputMapping[cmdKey].trim() : "";

        // Resolve template references like ${tempFilePath.path} or ${tempFilePath}
        if (/\$\{[^}]*(?:temp|file|path)[^}]*\}/i.test(cmd)) {
          const priorFileNode = intermediateNodes.find((n) => {
            if (n.type !== "plugin") return false;
            const mapping = (n.config?.inputMapping || {}) as Record<string, any>;
            return Boolean(mapping.path || mapping.file || mapping.filename);
          });
          const priorPath =
            (priorFileNode?.config?.inputMapping as any)?.path ||
            (priorFileNode?.config?.inputMapping as any)?.file ||
            "/tmp/temp_file.ts";
          cmd = cmd.replace(/\$\{[^}]*(?:temp|file|path)[^}]*\}/gi, priorPath);
        }

        if (!cmd || cmd === "input") {
          cmd = "${input}";
        }

        inputMapping[cmdKey] = cmd;
      }

      // 5. Working Directory / Folder parameter
      const cwdKey = hasParam(/^(?:cwd|dir|workingDirectory|folder|directory)$/i);
      if (cwdKey) {
        if (!inputMapping[cwdKey]) {
          inputMapping[cwdKey] = "${cwd}";
        } else if (
          typeof inputMapping[cwdKey] === "string" &&
          inputMapping[cwdKey].startsWith("/") &&
          !inputMapping[cwdKey].startsWith("/home/") &&
          !inputMapping[cwdKey].startsWith("/tmp/") &&
          !inputMapping[cwdKey].startsWith("/var/")
        ) {
          // The LLM invented an absolute path that doesn't exist on the host (e.g. "/project/src").
          inputMapping[cwdKey] = "${cwd}";
        }
      }

      // 6. URL parameter
      const urlKey = hasParam(/^(?:url|uri|link)$/i);
      if (urlKey && !inputMapping[urlKey]) {
        inputMapping[urlKey] = "input";
      }

      // 7. Query / Search parameter
      const queryKey = hasParam(/^(?:query|search|keyword|term)$/i);
      if (queryKey && !inputMapping[queryKey]) {
        inputMapping[queryKey] = "input";
      }

      node.config = {
        pluginId: effectivePluginId,
        inputMapping,
        outputKey: outKey,
      };

      if (config.newStateProperties?.[outKey]) {
        // Only accept the schema entry for THIS node's own outKey — see the
        // matching comment in the llm/agent branch for why unrelated keys
        // here must not pollute graph.stateSchema.
        graph.stateSchema[outKey] = config.newStateProperties[outKey];
      } else if (!graph.stateSchema[outKey]) {
        graph.stateSchema[outKey] = {
          type: "object",
          description: `Result from plugin ${effectivePluginId}`,
          required: false,
        };
      }
      return { usedFallback: false };
    },
    onFallback: (err: any) => {
      console.warn(
        `[Visual Builder - Generator] Plugin Config failed for ${node.id}:`,
        err?.message,
      );
      const fallbackMapping: Record<string, any> = {};
      const expectedFallbackKeys = new Set([
        ...(pluginDef.parameterKeys || []),
      ]);
      const hasFallbackParam = (pattern: RegExp) =>
        Array.from(expectedFallbackKeys).find((k) => pattern.test(k));

      const fbPathKey = hasFallbackParam(/^(?:path|file|filename|filePath)$/i);
      if (fbPathKey) {
        const fileMatch = prompt.match(
          /['"]?([a-zA-Z0-9_\-\.\/]+\.(?:log|md|json|txt|js|ts|py|html|sh))['"]?/i,
        );
        fallbackMapping[fbPathKey] = fileMatch ? fileMatch[1] : "output.txt";
      }

      const fbContentKey = hasFallbackParam(/^(?:content|data|body|text|payload|message)$/i);
      if (fbContentKey) {
        const incomingEdge = graph.edges.find((e) => e.target === node.id);
        const sourceNode = incomingEdge
          ? graph.nodes.find((n) => n.id === incomingEdge.source)
          : null;
        fallbackMapping[fbContentKey] =
          (sourceNode?.config?.outputKey as string) ||
          Object.keys(graph.stateSchema).find((k) => k !== "input") ||
          "result";
      }

      const fbOpKey = hasFallbackParam(/^(?:operation|action|mode|method)$/i);
      if (fbOpKey) {
        fallbackMapping[fbOpKey] = "write";
      }

      const fbCmdKey = hasFallbackParam(/^(?:command|cmd|script)$/i);
      if (fbCmdKey) {
        fallbackMapping[fbCmdKey] = "${input}";
      }

      const fbCwdKey = hasFallbackParam(/^(?:cwd|dir|workingDirectory)$/i);
      if (fbCwdKey) {
        fallbackMapping[fbCwdKey] = "${cwd}";
      }

      const fbUrlKey = hasFallbackParam(/^(?:url|uri|link)$/i);
      if (fbUrlKey) {
        fallbackMapping[fbUrlKey] = "input";
      }

      const fbQueryKey = hasFallbackParam(/^(?:query|search|keyword|term)$/i);
      if (fbQueryKey) {
        fallbackMapping[fbQueryKey] = "input";
      }

      for (const reqKey of pluginDef.requiredKeys || []) {
        if (fallbackMapping[reqKey] === undefined) {
          fallbackMapping[reqKey] = "input";
        }
      }

      node.config = {
        pluginId: selectedPluginId,
        inputMapping: fallbackMapping,
        outputKey: `${node.id}_data`,
      };
      return { usedFallback: true };
    },
  });
}
