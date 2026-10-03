import { assertEquals } from "@std/assert";
import { buildConditionNodeSchema } from "./condition-node-configurator.ts";

Deno.test("buildConditionNodeSchema - accepts a well-formed candidate with a known field, valid operator and value", () => {
  const schema = buildConditionNodeSchema(["is_valid", "score"]);
  const result = schema.safeParse({
    nodeId: "check1",
    nodeName: "Is Valid?",
    condition: { field: "is_valid", operator: "equals", value: true },
  });
  assertEquals(result.success, true);
});

Deno.test("buildConditionNodeSchema - with known state keys, condition.field is restricted to that enum", () => {
  const schema = buildConditionNodeSchema(["is_valid", "score"]);
  const bad = schema.safeParse({
    nodeId: "check1",
    nodeName: "Is Valid?",
    condition: { field: "not_a_real_key", operator: "equals", value: true },
  });
  assertEquals(bad.success, false);
});

Deno.test("buildConditionNodeSchema - with no state keys available, condition.field falls back to an unrestricted string", () => {
  const schema = buildConditionNodeSchema([]);
  const result = schema.safeParse({
    nodeId: "check1",
    nodeName: "Is Valid?",
    condition: { field: "anything_goes", operator: "equals", value: true },
  });
  assertEquals(result.success, true);
});

Deno.test("buildConditionNodeSchema - condition.operator must be one of the registered CONDITION_OPERATORS", () => {
  const schema = buildConditionNodeSchema(["score"]);
  const bad = schema.safeParse({
    nodeId: "check1",
    nodeName: "Score Check",
    condition: { field: "score", operator: "bogus_operator", value: 5 },
  });
  assertEquals(bad.success, false);
});

Deno.test("buildConditionNodeSchema - condition.value accepts any type (string, number, boolean)", () => {
  const schema = buildConditionNodeSchema(["score"]);
  for (const value of ["approved", 7, true, false]) {
    const result = schema.safeParse({
      nodeId: "check1",
      nodeName: "Check",
      condition: { field: "score", operator: "equals", value },
    });
    assertEquals(result.success, true);
  }
});

Deno.test("buildConditionNodeSchema - missing required top-level fields (nodeId/nodeName/condition) fails validation", () => {
  const schema = buildConditionNodeSchema(["score"]);
  assertEquals(schema.safeParse({ nodeId: "check1" }).success, false);
  assertEquals(schema.safeParse({}).success, false);
});
