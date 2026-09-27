import type { LangGraphAbstraction } from "./types.ts";

export type ViolationKind =
  | "syntax" // dot/bracket path access, malformed identifier
  | "undefined_variable" // ${varName} not produced by any node's outputKey
  | "invalid_plugin_param" // inputMapping key not in the plugin's real schema
  | "unequipped_tool_mention"; // systemPrompt mentions a tool not in config.plugins

export interface InputMappingViolation {
  kind: ViolationKind;
  nodeId: string;
  nodeName: string;
  field: string;
  invalidValue: string;
  reason: string;
}

export interface PluginParameterInfo {
  name: string;
  parameterKeys?: string[];
}

const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validates a single inputMapping value against the interpolation grammar:
 * a literal (no "${" at all), or one or more bare "${varName}" references.
 * Dot/bracket path access (e.g. "${a.b[0]}") is rejected — the runtime resolver
 * only supports flat state-key lookups. Returns null if valid, else a
 * human-readable reason suitable for feeding back into a correction prompt.
 */
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

/**
 * Walks every node's config.inputMapping in the graph and returns ALL
 * grammar violations found (accumulated, not fail-fast).
 */
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

/**
 * Extracts every "${varName}" reference from a grammar-valid plugin
 * inputMapping value. Assumes the value already passed
 * validateInterpolationValue (no dot/bracket paths) — used only to
 * cross-check that referenced variables were actually produced by some
 * node's outputKey.
 */
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

/**
 * Unlike plugin inputMapping (which mixes literals and "${var}" references,
 * requiring the braces to disambiguate them), llm/agent inputMapping values
 * are ALWAYS a bare state-key name — there is no literal case to disambiguate
 * from, so the value itself IS the variable name.
 */
function extractBareVarName(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return [value];
}

// Always present at runtime regardless of graph contents — not tied to any
// node's outputKey, so referencing them is always valid.
const BUILTIN_RUNTIME_KEYS = new Set(["input", "cwd", "os"]);

/**
 * Walks every node's config.inputMapping and confirms each referenced
 * "${varName}" was actually declared as an outputKey by some node in the
 * graph (or is a built-in runtime property like "input"/"cwd"/"os").
 *
 * Deliberately does NOT treat "graph.stateSchema" membership alone as proof
 * of validity: the initial skeleton seeds a placeholder "result" key (type
 * "unknown") before any node runs, so a reference to "${result}" would pass
 * a naive stateSchema-membership check even when no node actually wrote to
 * it — exactly the kind of dangling reference this check exists to catch.
 * "result" (and any other key) only counts as known once some node's
 * config.outputKey actually equals it.
 *
 * Only checks values that are already grammar-valid (dot/bracket violations
 * are reported separately by validateGraphInterpolationGrammar, not
 * duplicated here).
 */
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
    const isBareValueNode = node.type === "llm" || node.type === "agent";

    for (const [field, value] of Object.entries(inputMapping)) {
      if (!isBareValueNode && validateInterpolationValue(value) !== null) {
        continue; // grammar error already reported elsewhere
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

/**
 * Walks every "plugin" node's config.inputMapping and confirms every key
 * matches an actual parameter of that plugin's real Zod schema (parameterKeys,
 * extracted directly from the plugin's schema.shape). Catches invented/
 * hallucinated parameter names (e.g. a "url" key on a plugin whose schema has
 * no such field) that would otherwise be silently dropped by Zod's non-strict
 * parsing at execution time.
 */
export function validateGraphPluginParameters(
  graph: LangGraphAbstraction,
  availablePlugins: PluginParameterInfo[],
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];

  for (const node of graph.nodes) {
    if (node.type !== "plugin") continue;
    const inputMapping = node.config?.inputMapping as
      | Record<string, unknown>
      | undefined;
    if (!inputMapping) continue;

    const pluginId = node.config?.pluginId as string | undefined;
    const pluginDef = availablePlugins.find((p) => p.name === pluginId);
    if (!pluginDef?.parameterKeys || pluginDef.parameterKeys.length === 0) {
      continue; // no known schema to check against, skip rather than false-positive
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

// Normalizes plugin-name variants a model might use in free text
// ("file_ops", "file-ops", "file ops") down to one comparable form.
function normalizePluginMention(name: string): string {
  return name.toLowerCase().replace(/[-_\s]+/g, "_");
}

/**
 * Walks every "llm"/"agent" node's systemPrompt and flags a mention of a
 * real plugin's name (in any "-"/"_"/space separator variant) that is NOT
 * present in that node's config.plugins. This catches an agent whose
 * instructions promise to use a tool (e.g. "save the file using file-ops")
 * that it was never actually equipped with, so the promised action silently
 * cannot happen.
 */
export function validateGraphAgentToolMentions(
  graph: LangGraphAbstraction,
  availablePlugins: PluginParameterInfo[],
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];

  for (const node of graph.nodes) {
    if (node.type !== "llm" && node.type !== "agent") continue;
    const systemPrompt = node.config?.systemPrompt;
    if (typeof systemPrompt !== "string" || !systemPrompt) continue;

    const equipped = new Set(
      (Array.isArray(node.config?.plugins) ? (node.config.plugins as unknown[]) : [])
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
