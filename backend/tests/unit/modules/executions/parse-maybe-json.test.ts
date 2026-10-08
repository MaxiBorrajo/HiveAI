import { assertEquals } from "@std/assert";
import { parseMaybeJson } from "../../../../modules/executions/parse-maybe-json.ts";

Deno.test("parseMaybeJson - a valid JSON object string is parsed into an object", () => {
  assertEquals(parseMaybeJson('{"a":1,"b":"x"}'), { a: 1, b: "x" });
});

Deno.test("parseMaybeJson - a valid JSON array string is parsed into an array", () => {
  assertEquals(parseMaybeJson("[1,2,3]"), [1, 2, 3]);
});

Deno.test("parseMaybeJson - a plain non-JSON string is returned unchanged", () => {
  assertEquals(parseMaybeJson("just plain text"), "just plain text");
});

Deno.test("parseMaybeJson - a malformed JSON-looking string is returned unchanged rather than throwing", () => {
  assertEquals(parseMaybeJson("{not valid json"), "{not valid json");
});

Deno.test("parseMaybeJson - non-string values (object, number, null, undefined) pass through untouched", () => {
  const obj = { already: "parsed" };
  assertEquals(parseMaybeJson(obj), obj);
  assertEquals(parseMaybeJson(42), 42);
  assertEquals(parseMaybeJson(null), null);
  assertEquals(parseMaybeJson(undefined), undefined);
});

Deno.test("parseMaybeJson - a JSON string containing a primitive (number/boolean/null) parses to that primitive", () => {
  assertEquals(parseMaybeJson("42"), 42);
  assertEquals(parseMaybeJson("true"), true);
  assertEquals(parseMaybeJson("null"), null);
});
