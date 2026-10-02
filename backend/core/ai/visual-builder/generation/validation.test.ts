import { assertEquals } from "@std/assert";
import {
  validateInterpolationValue,
  validateGraphInterpolationGrammar,
  validateGraphVariableReferences,
  validateGraphPluginParameters,
  validateGraphAgentToolMentions,
} from "./validation.ts";
import { GraphNode, LangGraphAbstraction } from "../types.ts";

function node(overrides: Partial<GraphNode>): GraphNode {
  return { id: "n1", name: "Node", type: "plugin", config: {}, ...overrides };
}

function graph(nodes: GraphNode[]): LangGraphAbstraction {
  return { nodes, edges: [], stateSchema: {} };
}

// --- validateInterpolationValue ---

Deno.test("validateInterpolationValue - non-string or no template markers returns null", () => {
  assertEquals(validateInterpolationValue(42), null);
  assertEquals(validateInterpolationValue("plain text"), null);
});

Deno.test("validateInterpolationValue - bare identifier is valid", () => {
  assertEquals(validateInterpolationValue("${myVar}"), null);
});

Deno.test("validateInterpolationValue - dot/bracket path access is rejected", () => {
  const result = validateInterpolationValue("${user.name}");
  assertEquals(typeof result, "string");
  assertEquals(result!.includes("dot/bracket"), true);
});

Deno.test("validateInterpolationValue - invalid identifier characters are rejected", () => {
  const result = validateInterpolationValue("${123bad}");
  assertEquals(typeof result, "string");
});

// --- validateGraphInterpolationGrammar ---

Deno.test("validateGraphInterpolationGrammar - flags bad interpolation syntax in inputMapping", () => {
  const g = graph([
    node({ config: { inputMapping: { query: "${a.b}" } } }),
  ]);
  const violations = validateGraphInterpolationGrammar(g);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].kind, "syntax");
  assertEquals(violations[0].field, "query");
});

Deno.test("validateGraphInterpolationGrammar - no inputMapping produces no violations", () => {
  const g = graph([node({ config: {} })]);
  assertEquals(validateGraphInterpolationGrammar(g).length, 0);
});

// --- validateGraphVariableReferences ---

Deno.test("validateGraphVariableReferences - undefined variable reference is flagged", () => {
  const g = graph([
    node({ id: "n1", type: "plugin", config: { inputMapping: { q: "${missing}" } } }),
  ]);
  const violations = validateGraphVariableReferences(g);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].kind, "undefined_variable");
});

Deno.test("validateGraphVariableReferences - reference to an upstream outputKey is valid", () => {
  const g = graph([
    node({ id: "n1", type: "plugin", config: { outputKey: "searchResult" } }),
    node({ id: "n2", type: "plugin", config: { inputMapping: { q: "${searchResult}" } } }),
  ]);
  assertEquals(validateGraphVariableReferences(g).length, 0);
});

Deno.test("validateGraphVariableReferences - builtin runtime keys (input/cwd/os) are always known", () => {
  const g = graph([
    node({ id: "n1", type: "plugin", config: { inputMapping: { q: "${input}" } } }),
  ]);
  assertEquals(validateGraphVariableReferences(g).length, 0);
});

Deno.test("validateGraphVariableReferences - llm nodes use bare values, not ${} wrapped", () => {
  const g = graph([
    node({ id: "n1", type: "llm", config: { inputMapping: { context: "undefinedVar" } } }),
  ]);
  const violations = validateGraphVariableReferences(g);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].invalidValue, "undefinedVar");
});

// --- validateGraphPluginParameters ---

Deno.test("validateGraphPluginParameters - unknown plugin id is flagged", () => {
  const g = graph([node({ type: "plugin", config: { pluginId: "does-not-exist" } })]);
  const violations = validateGraphPluginParameters(g, [{ name: "web-search", parameterKeys: ["query"] }]);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].kind, "unknown_plugin");
});

Deno.test("validateGraphPluginParameters - invalid parameter key is flagged", () => {
  const g = graph([
    node({
      type: "plugin",
      config: { pluginId: "web-search", inputMapping: { bogusParam: "x" } },
    }),
  ]);
  const violations = validateGraphPluginParameters(g, [
    { name: "web-search", parameterKeys: ["query"] },
  ]);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].kind, "invalid_plugin_param");
  assertEquals(violations[0].field, "bogusParam");
});

Deno.test("validateGraphPluginParameters - valid parameter key passes", () => {
  const g = graph([
    node({
      type: "plugin",
      config: { pluginId: "web-search", inputMapping: { query: "x" } },
    }),
  ]);
  const violations = validateGraphPluginParameters(g, [
    { name: "web-search", parameterKeys: ["query"] },
  ]);
  assertEquals(violations.length, 0);
});

Deno.test("validateGraphPluginParameters - plugin with no declared parameterKeys skips param validation", () => {
  const g = graph([
    node({
      type: "plugin",
      config: { pluginId: "custom", inputMapping: { anything: "x" } },
    }),
  ]);
  const violations = validateGraphPluginParameters(g, [{ name: "custom" }]);
  assertEquals(violations.length, 0);
});

// --- validateGraphAgentToolMentions ---

Deno.test("validateGraphAgentToolMentions - flags mentioning an unequipped tool in systemPrompt", () => {
  const g = graph([
    node({
      type: "llm",
      config: { systemPrompt: "Use web-search to find results.", plugins: [] },
    }),
  ]);
  const violations = validateGraphAgentToolMentions(g, [{ name: "web-search" }]);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].kind, "unequipped_tool_mention");
});

Deno.test("validateGraphAgentToolMentions - equipped tool mention passes", () => {
  const g = graph([
    node({
      type: "llm",
      config: { systemPrompt: "Use web-search to find results.", plugins: ["web-search"] },
    }),
  ]);
  assertEquals(validateGraphAgentToolMentions(g, [{ name: "web-search" }]).length, 0);
});

Deno.test("validateGraphAgentToolMentions - normalizes hyphens/underscores when comparing", () => {
  const g = graph([
    node({
      type: "llm",
      config: { systemPrompt: "Use web_search for lookups.", plugins: ["web-search"] },
    }),
  ]);
  assertEquals(validateGraphAgentToolMentions(g, [{ name: "web-search" }]).length, 0);
});

Deno.test("validateGraphAgentToolMentions - non-llm nodes are ignored", () => {
  const g = graph([
    node({ type: "plugin", config: { systemPrompt: "Use web-search", plugins: [] } }),
  ]);
  assertEquals(validateGraphAgentToolMentions(g, [{ name: "web-search" }]).length, 0);
});
