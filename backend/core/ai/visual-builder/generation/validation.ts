import type { InputMappingViolation, LangGraphAbstraction, PluginParameterInfo } from "../types.ts";


const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateInterpolationValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.includes("${")) return null;

  const re = /\$\{([^}]*)\}/g;
  const violations: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const inner = match[1];
    if (inner.includes(".") || inner.includes("[") || inner.includes("]")) {
      violations.push(
        `"\${${inner}}" uses dot/bracket path access, which is NOT supported. Only bare variable names are allowed (e.g. "\${varName}").`,
      );
    } else if (!VALID_IDENTIFIER.test(inner)) {
      violations.push(`"\${${inner}}" is not a valid bare identifier.`);
    }
  }
  return violations.length > 0 ? violations.join(" ") : null;
}

export function validateGraphInterpolationGrammar(
  graph: LangGraphAbstraction,
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];
  for (const node of graph.nodes) {
    const inputMapping = node.config?.inputMapping as
      | Record<string, unknown>
      | undefined;
    if (!inputMapping) continue;
    for (const [field, value] of Object.entries(inputMapping)) {
      const reason = validateInterpolationValue(value);
      if (reason) {
        violations.push({
          kind: "syntax",
          nodeId: node.id,
          nodeName: node.name,
          field,
          invalidValue: String(value),
          reason,
        });
      }
    }
  }
  return violations;
}

function extractVarNames(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const re = /\$\{([^}]*)\}/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function extractBareVarName(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return [value];
}

const BUILTIN_RUNTIME_KEYS = new Set(["input", "cwd", "os"]);

export function validateGraphVariableReferences(
  graph: LangGraphAbstraction,
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];
  const knownKeys = new Set(BUILTIN_RUNTIME_KEYS);
  for (const node of graph.nodes) {
    const outputKey = node.config?.outputKey;
    if (typeof outputKey === "string" && outputKey.length > 0) {
      knownKeys.add(outputKey);
    }
  }

  for (const node of graph.nodes) {
    const inputMapping = node.config?.inputMapping as
      | Record<string, unknown>
      | undefined;
    if (!inputMapping) continue;
    const isBareValueNode = node.type === "llm";

    for (const [field, value] of Object.entries(inputMapping)) {
      if (!isBareValueNode && validateInterpolationValue(value) !== null) {
        continue;
      }
      const varNames = isBareValueNode
        ? extractBareVarName(value)
        : extractVarNames(value);

      for (const varName of varNames) {
        if (!knownKeys.has(varName)) {
          violations.push({
            kind: "undefined_variable",
            nodeId: node.id,
            nodeName: node.name,
            field,
            invalidValue: String(value),
            reason: isBareValueNode
              ? `"${varName}" references a variable that no node in the workflow produces (no matching outputKey/state property). Reference a variable that an upstream node actually writes, or add an upstream node that produces it.`
              : `"\${${varName}}" references a variable that no node in the workflow produces (no matching outputKey/state property). Reference a variable that an upstream node actually writes, or add an upstream node that produces it.`,
          });
        }
      }
    }
  }
  
  return violations;
}

export function validateGraphPluginParameters(
  graph: LangGraphAbstraction,
  availablePlugins: PluginParameterInfo[],
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];

  for (const node of graph.nodes) {
    if (node.type !== "plugin") continue;

    const pluginId = node.config?.pluginId as string | undefined;
    const pluginDef = availablePlugins.find((p) => p.name === pluginId);
    if (pluginId && !pluginDef) {
      violations.push({
        kind: "unknown_plugin",
        nodeId: node.id,
        nodeName: node.name,
        field: "pluginId",
        invalidValue: pluginId,
        reason: `"${pluginId}" is not a registered plugin. Available plugins: [${availablePlugins.map((p) => p.name).join(", ")}]. Replace "pluginId" with one of the valid plugin names.`,
      });
      continue;
    }

    const inputMapping = node.config?.inputMapping as
      | Record<string, unknown>
      | undefined;
    if (!inputMapping) continue;

    if (!pluginDef?.parameterKeys || pluginDef.parameterKeys.length === 0) {
      continue;
    }
    const validKeys = new Set(pluginDef.parameterKeys);

    for (const field of Object.keys(inputMapping)) {
      if (!validKeys.has(field)) {
        violations.push({
          kind: "invalid_plugin_param",
          nodeId: node.id,
          nodeName: node.name,
          field,
          invalidValue: String(inputMapping[field]),
          reason: `"${field}" is not a valid parameter of plugin "${pluginId}". Valid parameters are: [${Array.from(validKeys).join(", ")}]. Remove this key or replace it with one of the valid parameter names.`,
        });
      }
    }
  }
  return violations;
}

function normalizePluginMention(name: string): string {
  return name.toLowerCase().replace(/[-_\s]+/g, "_");
}

export function validateGraphAgentToolMentions(
  graph: LangGraphAbstraction,
  availablePlugins: PluginParameterInfo[],
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];

  for (const node of graph.nodes) {
    if (node.type !== "llm") continue;
    const systemPrompt = node.config?.systemPrompt;
    if (typeof systemPrompt !== "string" || !systemPrompt) continue;

    const equipped = new Set(
      (Array.isArray(node.config?.plugins)
        ? (node.config.plugins as unknown[])
        : []
      )
        .filter((p): p is string => typeof p === "string")
        .map(normalizePluginMention),
    );

    const normalizedPrompt = normalizePluginMention(systemPrompt);
    for (const plugin of availablePlugins) {
      const normalizedName = normalizePluginMention(plugin.name);
      if (!normalizedPrompt.includes(normalizedName)) continue;
      if (equipped.has(normalizedName)) continue;

      violations.push({
        kind: "unequipped_tool_mention",
        nodeId: node.id,
        nodeName: node.name,
        field: "systemPrompt",
        invalidValue: systemPrompt,
        reason: `This node's systemPrompt mentions using the "${plugin.name}" tool, but "${plugin.name}" is NOT in this node's "plugins" list (currently: [${Array.from(equipped).join(", ") || "none"}]). Either add "${plugin.name}" to plugins, or remove that instruction from systemPrompt and let a downstream node handle it instead.`,
      });
    }
  }
  return violations;
}
