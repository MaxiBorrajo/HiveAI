import { assertEquals, assertRejects } from "@std/assert";
import {
  resolveMappingValue,
  resolveInputMapping,
  createPluginNodeRegistry,
} from "./plugin-node-executor.ts";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";

// --- resolveMappingValue ---

Deno.test("resolveMappingValue - a bare '${var}' template resolves to the state value", () => {
  assertEquals(resolveMappingValue("${query}", { query: "hello" }), "hello");
});

Deno.test("resolveMappingValue - a bare '${var}' template with no matching state key returns the template unchanged", () => {
  assertEquals(resolveMappingValue("${missing}", {}), "${missing}");
});

Deno.test("resolveMappingValue - an exact string match to a state key resolves to its value", () => {
  assertEquals(resolveMappingValue("query", { query: "hello" }), "hello");
});

Deno.test("resolveMappingValue - a string with embedded '${var}' interpolates in place", () => {
  assertEquals(
    resolveMappingValue("Hello ${name}!", { name: "World" }),
    "Hello World!",
  );
});

Deno.test("resolveMappingValue - an embedded template with a missing var is left as-is", () => {
  assertEquals(
    resolveMappingValue("Hello ${missing}!", {}),
    "Hello ${missing}!",
  );
});

Deno.test("resolveMappingValue - a plain literal string with no state match and no template syntax passes through", () => {
  assertEquals(resolveMappingValue("literal value", {}), "literal value");
});

Deno.test("resolveMappingValue - non-string values (number/boolean) pass through unchanged", () => {
  assertEquals(resolveMappingValue(42, {}), 42);
  assertEquals(resolveMappingValue(true, {}), true);
});

Deno.test("resolveMappingValue - an object with a 'value' field unwraps to that value", () => {
  assertEquals(resolveMappingValue({ value: "${query}" }, { query: "hi" }), "hi");
});

Deno.test("resolveMappingValue - an object with a 'staticValue' field unwraps to that value", () => {
  assertEquals(resolveMappingValue({ staticValue: 5 }, {}), 5);
});

Deno.test("resolveMappingValue - an object with neither 'value' nor 'staticValue' passes through as-is", () => {
  const obj = { foo: "bar" };
  assertEquals(resolveMappingValue(obj, {}), obj);
});

// --- resolveInputMapping ---

Deno.test("resolveInputMapping - resolves every key independently against the same state", () => {
  const result = resolveInputMapping(
    { query: "${search}", limit: 5, label: "fixed" },
    { search: "cats" },
  );
  assertEquals(result, { query: "cats", limit: 5, label: "fixed" });
});

Deno.test("resolveInputMapping - empty mapping returns an empty object", () => {
  assertEquals(resolveInputMapping({}, { any: "state" }), {});
});

// --- createPluginNodeRegistry ---

function fakeHive(tools: Record<string, (args: unknown) => Promise<unknown>>) {
  return {
    getTool: (name: string) => {
      const handler = tools[name];
      if (!handler) return undefined;
      return { invoke: handler };
    },
  } as unknown as HiveMicrokernel;
}

Deno.test("createPluginNodeRegistry - plugin executor resolves inputMapping, invokes the tool, and wraps result under outputKey", async () => {
  const hive = fakeHive({
    "web-search": async (args) => `results for ${(args as any).query}`,
  });
  const registry = createPluginNodeRegistry(hive);

  const result = await registry.plugin(
    { search_term: "cats" },
    { pluginId: "web-search", inputMapping: { query: "${search_term}" }, outputKey: "search_results" },
  );

  assertEquals(result, { search_results: "results for cats" });
});

Deno.test("createPluginNodeRegistry - falls back to the plugin id as the output key when outputKey is not set", async () => {
  const hive = fakeHive({
    counter: async () => "5",
  });
  const registry = createPluginNodeRegistry(hive);

  const result = await registry.plugin({}, { pluginId: "counter", inputMapping: {} });

  assertEquals(result, { counter: "5" });
});

Deno.test("createPluginNodeRegistry - throws when the requested tool is not registered in the hive", async () => {
  const hive = fakeHive({});
  const registry = createPluginNodeRegistry(hive);

  await assertRejects(
    () => registry.plugin({}, { pluginId: "does-not-exist", inputMapping: {} }),
    Error,
    "Tool does-not-exist not found",
  );
});
