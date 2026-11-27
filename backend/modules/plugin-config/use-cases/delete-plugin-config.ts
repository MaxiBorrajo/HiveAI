import { loadConfigFields } from "../lib.ts";
import type { PluginConfigDeps } from "../types.ts";
import { configId } from "./get-plugin-config.ts";

export async function deletePluginConfig(
  deps: PluginConfigDeps,
  pluginName: string,
  key: string,
): Promise<void> {
  await loadConfigFields(deps, pluginName);

  const id = configId(pluginName, key);
  await deps.secrets.delete(id);
  await deps.repo.delete(id);

  await deps.hive.restartExternalPlugin(pluginName);
}
