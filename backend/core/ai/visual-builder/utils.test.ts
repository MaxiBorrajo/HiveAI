import { assertEquals, assertThrows } from "@std/assert";
import {
  evaluateCondition,
  getFieldByPath,
  getReducerFunction,
  mapTypeToZod,
  describeNeighbor,
} from "./utils.ts";
import { GraphNode } from "./types.ts";

// --- getReducerFunction ---

Deno.test("getReducerFunction - overwrite/default returns undefined", () => {
  assertEquals(getReducerFunction("overwrite"), undefined);
  assertEquals(getReducerFunction(undefined), undefined);
});

Deno.test("getReducerFunction - append concatenates arrays, treats nullish as empty", () => {
  const fn = getReducerFunction("append")! as any;
  assertEquals(fn([1, 2], [3]), [1, 2, 3]);
  assertEquals(fn(undefined, [1]), [1]);
  assertEquals(fn([1], undefined), [1]);
});

Deno.test("getReducerFunction - prepend puts new value first", () => {
  const fn = getReducerFunction("prepend")! as any;
  assertEquals(fn([1, 2], [3]), [3, 1, 2]);
});

Deno.test("getReducerFunction - unique_append dedupes", () => {
  const fn = getReducerFunction("unique_append")! as any;
  assertEquals(fn([1, 2], [2, 3]), [1, 2, 3]);
});

Deno.test("getReducerFunction - merge_dict shallow merges, b wins", () => {
  const fn = getReducerFunction("merge_dict")! as any;
  assertEquals(fn({ a: 1, b: 1 }, { b: 2, c: 3 }), { a: 1, b: 2, c: 3 });
});

Deno.test("getReducerFunction - sum/subtract/multiply/divide arithmetic", () => {
  assertEquals((getReducerFunction("sum")! as any)(2, 3), 5);
  assertEquals((getReducerFunction("subtract")! as any)(5, 3), 2);
  assertEquals((getReducerFunction("multiply")! as any)(2, 3), 6);
  assertEquals((getReducerFunction("divide")! as any)(6, 3), 2);
});

Deno.test("getReducerFunction - sum treats undefined operands as 0", () => {
  assertEquals((getReducerFunction("sum")! as any)(undefined, 5), 5);
});

Deno.test("getReducerFunction - multiply treats undefined operands as 1 (not 0)", () => {
  assertEquals((getReducerFunction("multiply")! as any)(undefined, 5), 5);
});

Deno.test("getReducerFunction - divide by zero throws", () => {
  const fn = getReducerFunction("divide")! as any;
  assertThrows(() => fn(6, 0), Error, "Division by zero");
});

// --- getFieldByPath ---

Deno.test("getFieldByPath - resolves nested dotted paths", () => {
  const source = { a: { b: { c: 42 } } };
  assertEquals(getFieldByPath(source, "a.b.c"), 42);
});

Deno.test("getFieldByPath - returns undefined for missing intermediate keys", () => {
  const source = { a: {} };
  assertEquals(getFieldByPath(source, "a.b.c"), undefined);
});

Deno.test("getFieldByPath - single-level path", () => {
  assertEquals(getFieldByPath({ x: 1 }, "x"), 1);
});

// --- evaluateCondition ---

Deno.test("evaluateCondition - boolean equals/not_equals, coerces string 'true'", () => {
  assertEquals(evaluateCondition("true", "equals", true), true);
  assertEquals(evaluateCondition("false", "equals", true), false);
  assertEquals(evaluateCondition(false, "not_equals", true), true);
});

Deno.test("evaluateCondition - numeric comparisons coerce strings, NaN is false", () => {
  assertEquals(evaluateCondition("5", "greater_than", 3), true);
  assertEquals(evaluateCondition("abc", "greater_than", 3), false);
  assertEquals(evaluateCondition(3, "less_than_or_equals", 3), true);
});

Deno.test("evaluateCondition - string operators", () => {
  assertEquals(evaluateCondition("hello world", "contains", "world"), true);
  assertEquals(evaluateCondition("hello world", "not_contains", "xyz"), true);
  assertEquals(evaluateCondition("hello", "starts_with", "he"), true);
  assertEquals(evaluateCondition("hello", "ends_with", "lo"), true);
  assertEquals(evaluateCondition("", "is_empty", null), true);
  assertEquals(evaluateCondition("x", "is_not_empty", null), true);
});

Deno.test("evaluateCondition - array contains/in", () => {
  assertEquals(evaluateCondition("b", "in", ["a", "b", "c"]), true);
  assertEquals(evaluateCondition("z", "not_in", ["a", "b", "c"]), true);
});

Deno.test("evaluateCondition - contains works with a numeric target inside a number array", () => {
  assertEquals(evaluateCondition([1, 2, 3], "contains", 2), true);
  assertEquals(evaluateCondition([1, 2, 3], "contains", 9), false);
});

Deno.test("evaluateCondition - in/not_in work with a numeric fieldValue", () => {
  assertEquals(evaluateCondition(2, "in", [1, 2, 3]), true);
  assertEquals(evaluateCondition(9, "not_in", [1, 2, 3]), true);
});

Deno.test("evaluateCondition - contains works when target is a string", () => {
  assertEquals(evaluateCondition(["a", "b", "c"], "contains", "b"), true);
});

Deno.test("evaluateCondition - regex_match", () => {
  assertEquals(evaluateCondition("hello123", "regex_match", "^hello\\d+$"), true);
  assertEquals(evaluateCondition("nope", "regex_match", "^hello\\d+$"), false);
});

Deno.test("evaluateCondition - is_empty treats empty array as empty", () => {
  assertEquals(evaluateCondition([], "is_empty", null), true);
  assertEquals(evaluateCondition([1], "is_empty", null), false);
});

Deno.test("evaluateCondition - unknown operator returns false", () => {
  assertEquals(evaluateCondition("x", "bogus" as any, "y"), false);
});

// --- mapTypeToZod ---

Deno.test("mapTypeToZod - required string accepts strings, rejects numbers", () => {
  const schema = mapTypeToZod({ type: "string", required: true });
  assertEquals(schema.safeParse("hi").success, true);
  assertEquals(schema.safeParse(42).success, false);
});

Deno.test("mapTypeToZod - optional field allows undefined", () => {
  const schema = mapTypeToZod({ type: "number", required: false });
  assertEquals(schema.safeParse(undefined).success, true);
});

Deno.test("mapTypeToZod - enum restricts to options", () => {
  const schema = mapTypeToZod({
    type: "enum",
    required: true,
    options: ["a", "b"],
  });
  assertEquals(schema.safeParse("a").success, true);
  assertEquals(schema.safeParse("c").success, false);
});

Deno.test("mapTypeToZod - nested object builds shape from properties", () => {
  const schema = mapTypeToZod({
    type: "object",
    required: true,
    properties: {
      name: { type: "string", required: true },
      age: { type: "number", required: false },
    },
  });
  assertEquals(schema.safeParse({ name: "a" }).success, true);
  assertEquals(schema.safeParse({ age: 1 }).success, false);
});

Deno.test("mapTypeToZod - array of items validates each element", () => {
  const schema = mapTypeToZod({
    type: "array",
    required: true,
    items: { type: "number", required: true },
  });
  assertEquals(schema.safeParse([1, 2, 3]).success, true);
  assertEquals(schema.safeParse([1, "x"]).success, false);
});

// --- describeNeighbor ---

Deno.test("describeNeighbor - returns 'none' for undefined node", () => {
  assertEquals(describeNeighbor(undefined, new Map()), "none");
});

Deno.test("describeNeighbor - includes role, outputKey and tools when present", () => {
  const node: GraphNode = {
    id: "n1",
    name: "Fetch",
    type: "llm",
    config: { outputKey: "result", plugins: ["web-search"] },
  };
  const descriptions = new Map([["n1", "fetches stuff"]]);
  const desc = describeNeighbor(node, descriptions);
  assertEquals(
    desc,
    `"Fetch" (type: llm, role: "fetches stuff", outputKey: "result", tools: [web-search])`,
  );
});
