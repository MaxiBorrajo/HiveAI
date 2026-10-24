import { assertEquals } from "@std/assert";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { BeeContext } from "../../../../core/microkernel/bee-plugin.ts";
import CounterPlugin from "../../../../plugins/counter/index.ts";

let capturedContext: BeeContext | undefined;

class ContextCapturingPlugin extends CounterPlugin {
  override initialize(context: BeeContext): void {
    capturedContext = context;
  }
}

async function withRegisteredPlugin(
  pluginName: string,
  fn: (context: BeeContext) => Promise<void>,
) {
  const hive = HiveMicrokernel.getInstance();
  const tempDir = await Deno.makeTempDir();
  hive.configure({ dataDir: tempDir, configDir: tempDir });

  const plugin = new ContextCapturingPlugin();
  plugin.name = pluginName;
  await hive.register(plugin);

  try {
    await fn(capturedContext!);
  } finally {
    await hive.unregister(pluginName);
    capturedContext = undefined;
  }
}

Deno.test("BeeContext.getConfig() reads back a value set via the config store, scoped to the plugin name", async () => {
  await withRegisteredPlugin("ctx-config-plugin-1", async (ctx) => {
    const { getSecretStore } = await import("../../../../core/secrets/index.ts");
    await getSecretStore().put("ctx-config-plugin-1:SOME_KEY", "hello");

    assertEquals(await ctx.getConfig("SOME_KEY"), "hello");
  });
});

Deno.test("BeeContext.getConfig() returns undefined for a key nobody ever set", async () => {
  await withRegisteredPlugin("ctx-config-plugin-2", async (ctx) => {
    assertEquals(await ctx.getConfig("NEVER_SET"), undefined);
  });
});

Deno.test("BeeContext.getConfig() is scoped per plugin — one plugin cannot read another plugin's value for the same key name", async () => {
  await withRegisteredPlugin("ctx-config-plugin-3a", async (ctxA) => {
    const { getSecretStore } = await import("../../../../core/secrets/index.ts");
    await getSecretStore().put("ctx-config-plugin-3a:API_KEY", "value-for-a");
    await getSecretStore().put("ctx-config-plugin-3b:API_KEY", "value-for-b");

    assertEquals(await ctxA.getConfig("API_KEY"), "value-for-a");
  });
});
