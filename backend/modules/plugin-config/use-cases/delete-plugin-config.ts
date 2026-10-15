import { AppError } from "../../../core/api/errors.ts";
import type { PluginConfigDeps } from "../types.ts";
import { configId } from "./get-plugin-config.ts";

export async function deletePluginConfig(
  deps: PluginConfigDeps,
  pluginName: string,
  key: string,
): Promise<void> {
  const plugin = deps.hive.getPlugin(pluginName);
  if (!plugin) throw new AppError("Plugin not found.", 404);

  const id = configId(pluginName, key);
  await deps.secrets.delete(id);
  await deps.repo.delete(id);
}
