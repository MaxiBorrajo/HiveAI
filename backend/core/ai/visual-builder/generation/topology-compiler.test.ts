import { assertEquals } from "@std/assert";
import { normalizePluginName } from "./topology-compiler.ts";
import { PluginInfo } from "../types.ts";

function plugin(name: string): PluginInfo {
  return { name, description: "" };
}

Deno.test("normalizePluginName - undefined input returns undefined", () => {
  assertEquals(normalizePluginName(undefined, [plugin("web-search")]), undefined);
});

Deno.test("normalizePluginName - exact match (ignoring hyphens/underscores/case)", () => {
  assertEquals(normalizePluginName("Web_Search", [plugin("web-search")]), "web-search");
});

Deno.test("normalizePluginName - partial match falls back when no direct match", () => {
  assertEquals(normalizePluginName("search", [plugin("web-search")]), "web-search");
});

Deno.test("normalizePluginName - no match returns undefined", () => {
  assertEquals(normalizePluginName("totally-unrelated", [plugin("web-search")]), undefined);
});

Deno.test("normalizePluginName - prefers direct match over a partial match on a different plugin", () => {
  const plugins = [plugin("file-search"), plugin("web-search")];
  assertEquals(normalizePluginName("web-search", plugins), "web-search");
});
