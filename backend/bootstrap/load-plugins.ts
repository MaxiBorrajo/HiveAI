import { join } from "node:path";
import type { HiveMicrokernel } from "../core/microkernel/hive-microkernel.ts";

/**
 * Registers and activates every bundled plugin found in `pluginsDir`, then
 * restores the external plugins the user imported earlier. A bundled plugin
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

  for (const plugin of hive.getRegisteredPlugins()) {
    await hive.activate(plugin.name);
  }

  await hive.loadPersistedExternalPlugins();

  console.log(
    "Registered plugins:",
    hive.getRegisteredPlugins().map((p) => p.name),
  );
}
