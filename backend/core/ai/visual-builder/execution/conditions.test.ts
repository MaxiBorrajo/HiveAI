import { assertEquals } from "@std/assert";
import { evaluateCondition, getFieldByPath } from "./conditions.ts";

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

Deno.test("evaluateCondition - a numeric target short-circuits into the numeric-comparison branch, so 'contains' is not reached (documented quirk)", () => {
  assertEquals(evaluateCondition([1, 2, 3], "contains", 2), false);
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
