import { join } from "node:path";
import type { HiveMicrokernel } from "../core/microkernel/hive-microkernel.ts";

/**
 * Registers every bundled plugin found in `pluginsDir`, activates those the user
 * has not turned off, then restores the external plugins imported earlier and
 * their saved active state. A bundled plugin
 * that fails to load is reported and skipped instead of aborting startup.
 */
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

  // A plugin the user turned off earlier stays off across restarts.
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
