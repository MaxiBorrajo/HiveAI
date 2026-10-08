import { assertEquals } from "@std/assert";
import { HiveMicrokernel } from "../../../../../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../../../../../plugins/counter/index.ts";
import { describeActivePlugins } from "../../../../../../modules/executions/use-cases/generate-execution/describe-plugins.ts";

// describeActivePlugins reads from the HiveMicrokernel singleton, so each
// test registers its own uniquely-named plugin and tears it down after.
async function withRegisteredCounter(
  pluginName: string,
  fn: (hive: HiveMicrokernel) => Promise<void> | void,
) {
  const hive = HiveMicrokernel.getInstance();
  const tempDir = await Deno.makeTempDir();
  hive.configure({ dataDir: tempDir });

  const plugin = new CounterPlugin();
  plugin.name = pluginName;
  await hive.register(plugin);
  await hive.activate(pluginName);

  try {
    await fn(hive);
  } finally {
    await hive.unregister(pluginName);
  }
}

Deno.test("describeActivePlugins - returns an empty array when no plugins are active", async () => {
  const hive = HiveMicrokernel.getInstance();
  const tempDir = await Deno.makeTempDir();
  hive.configure({ dataDir: tempDir });

  const plugin = new CounterPlugin();
  plugin.name = "describe-plugins-inactive";
  await hive.register(plugin);
  // Deliberately not activated.

  try {
    const result = describeActivePlugins(hive).filter(
      (p) => p.name === "describe-plugins-inactive",
    );
    assertEquals(result, []);
  } finally {
    await hive.unregister("describe-plugins-inactive");
  }
});

Deno.test("describeActivePlugins - includes name, description and returnDescription from the active plugin", async () => {
  await withRegisteredCounter("describe-plugins-counter-1", async (hive) => {
    const info = describeActivePlugins(hive).find(
      (p) => p.name === "describe-plugins-counter-1",
    );
    assertEquals(info !== undefined, true);
    assertEquals(info!.description.includes("persistent named counters"), true);
    assertEquals(info!.returnDescription?.includes("plain-text confirmation"), true);
  });
});

Deno.test("describeActivePlugins - extracts every schema field as a parameterKey", async () => {
  await withRegisteredCounter("describe-plugins-counter-2", async (hive) => {
    const info = describeActivePlugins(hive).find(
      (p) => p.name === "describe-plugins-counter-2",
    );
    // CounterPlugin's schema has: name (required), action (optional, has a
    // default), amount (optional, has a default).
    assertEquals(new Set(info!.parameterKeys), new Set(["name", "action", "amount"]));
  });
});

Deno.test("describeActivePlugins - requiredKeys only includes fields without a default/optional wrapper", async () => {
  await withRegisteredCounter("describe-plugins-counter-3", async (hive) => {
    const info = describeActivePlugins(hive).find(
      (p) => p.name === "describe-plugins-counter-3",
    );
    assertEquals(info!.requiredKeys, ["name"]);
  });
});

Deno.test("describeActivePlugins - parametersDescription marks each field REQUIRED or optional with its zod description", () => {
  return withRegisteredCounter("describe-plugins-counter-4", async (hive) => {
    const info = describeActivePlugins(hive).find(
      (p) => p.name === "describe-plugins-counter-4",
    );
    assertEquals(info!.parametersDescription?.includes("name (REQUIRED"), true);
    assertEquals(info!.parametersDescription?.includes("action (optional"), true);
  });
});

Deno.test("describeActivePlugins - parameterSchema exposes the raw zod shape for the plugin's fields", () => {
  return withRegisteredCounter("describe-plugins-counter-5", async (hive) => {
    const info = describeActivePlugins(hive).find(
      (p) => p.name === "describe-plugins-counter-5",
    );
    assertEquals(typeof info!.parameterSchema?.name?.safeParse, "function");
  });
});

Deno.test("describeActivePlugins - returns one entry per active plugin, matching getTools() count", () => {
  return withRegisteredCounter("describe-plugins-counter-6", async (hive) => {
    const infos = describeActivePlugins(hive);
    assertEquals(infos.length, hive.getTools().length);
  });
});
