import { assertEquals } from "@std/assert";
import { stateKeySchema, resolveOutputKey } from "../../../../../../core/ai/visual-builder/generation/shared.ts";
import type { GraphNode } from "../../../../../../core/ai/visual-builder/types.ts";

function node(overrides: Partial<GraphNode>): GraphNode {
  return { id: "n1", name: "Node", type: "plugin", config: {}, ...overrides };
}

// --- stateKeySchema ---

Deno.test("stateKeySchema - with available keys, builds an enum restricted to exactly those keys", () => {
  const schema = stateKeySchema(["foo", "bar"], "enum desc", "fallback desc");
  assertEquals(schema.safeParse("foo").success, true);
  assertEquals(schema.safeParse("bar").success, true);
  assertEquals(schema.safeParse("baz").success, false);
});

Deno.test("stateKeySchema - filters out blank/whitespace-only keys before building the enum", () => {
  const schema = stateKeySchema(["foo", "", "   "], "enum desc", "fallback desc");
  assertEquals(schema.safeParse("foo").success, true);
  assertEquals(schema.safeParse("").success, false);
});

Deno.test("stateKeySchema - with no valid keys at all, falls back to an unrestricted string schema", () => {
  const schema = stateKeySchema([], "enum desc", "fallback desc");
  assertEquals(schema.safeParse("anything").success, true);
  assertEquals(schema.safeParse(42).success, false);
});

Deno.test("stateKeySchema - blank-only input also falls back to the unrestricted string schema", () => {
  const schema = stateKeySchema(["", "  "], "enum desc", "fallback desc");
  assertEquals(schema.safeParse("literally anything").success, true);
});

// --- resolveOutputKey ---

Deno.test("resolveOutputKey - uses the configured key when provided", () => {
  const n = node({ id: "step1" });
  assertEquals(resolveOutputKey(n, "my_output", "_data", [n]), "my_output");
});

Deno.test("resolveOutputKey - falls back to '<nodeId><suffix>' when no key is configured", () => {
  const n = node({ id: "step1" });
  assertEquals(resolveOutputKey(n, undefined, "_data", [n]), "step1_data");
});

Deno.test("resolveOutputKey - an empty-string configured key is treated as not configured (falls back)", () => {
  const n = node({ id: "step1" });
  assertEquals(resolveOutputKey(n, "", "_data", [n]), "step1_data");
});

Deno.test("resolveOutputKey - the reserved name 'result' is allowed for the LAST intermediate node", () => {
  const n1 = node({ id: "step1" });
  const n2 = node({ id: "step2" });
  assertEquals(resolveOutputKey(n2, "result", "_data", [n1, n2]), "result");
});

Deno.test("resolveOutputKey - the reserved name 'result' is rejected (falls back) for any NON-last intermediate node", () => {
  const n1 = node({ id: "step1" });
  const n2 = node({ id: "step2" });
  assertEquals(resolveOutputKey(n1, "result", "_data", [n1, n2]), "step1_data");
});

Deno.test("resolveOutputKey - a node not present in intermediateNodes at all is treated as non-last (rejects 'result')", () => {
  const n1 = node({ id: "step1" });
  const other = node({ id: "other" });
  assertEquals(resolveOutputKey(other, "result", "_data", [n1]), "other_data");
});

Deno.test("resolveOutputKey - an empty intermediateNodes list never matches 'isLastIntermediate', so 'result' is always rejected", () => {
  const n1 = node({ id: "step1" });
  assertEquals(resolveOutputKey(n1, "result", "_data", []), "step1_data");
});
