import { join } from "node:path";
import type { HiveMicrokernel } from "../core/microkernel/hive-microkernel.ts";

// Every active tool is sent with each model request. These two rarely matter
// (the date is already in the system prompt; counters are a demo), so new
// installs start with them off. An explicit user choice, saved in the DB,
// always wins, so existing installs keep their current state.
export const OFF_BY_DEFAULT_PLUGINS: ReadonlySet<string> = new Set([
  "counter",
  "current_datetime",
]);

export function shouldActivateByDefault(
  name: string,
  persisted: boolean | undefined,
): boolean {
  if (persisted !== undefined) return persisted;
  return !OFF_BY_DEFAULT_PLUGINS.has(name);
}

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
    if (shouldActivateByDefault(plugin.name, persisted)) {
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
