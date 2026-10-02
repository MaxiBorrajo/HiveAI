import { assertEquals, assertThrows } from "@std/assert";
import { getReducerFunction, mapTypeToZod } from "./state.ts";

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
