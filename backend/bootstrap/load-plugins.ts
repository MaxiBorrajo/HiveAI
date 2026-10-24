import { join } from "node:path";
import type { HiveMicrokernel } from "../core/microkernel/hive-microkernel.ts";

export async function loadPlugins(
  hive: HiveMicrokernel,
  pluginsDir: string,
): Promise<void> {
  for await (const entry of Deno.readDir(pluginsDir)) {
    if (!entry.isDirectory) continue;
    try {
      await hive.loadAndRegister(join(pluginsDir, entry.name));
    } catch (error) {
      console.error(`Failed to load bundled plugin '${entry.name}':`, error);
    }
  }

  for (const plugin of hive.getRegisteredPlugins()) {
    const persisted = await hive.getPersistedActiveState(plugin.name);
    if (persisted !== false) {
      await hive.activate(plugin.name);
    }
  }

  await hive.loadPersistedExternalPlugins();

  await hive.restorePersistedActiveStates();

  console.log(
    "Registered plugins:",
    hive.getRegisteredPlugins().map((p) => p.name),
  );
}
