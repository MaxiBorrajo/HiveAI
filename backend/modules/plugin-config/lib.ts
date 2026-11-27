import { AppError } from "../../core/api/errors.ts";
import type { PluginConfigField } from "../../core/microkernel/bee-plugin.ts";
import type { PluginConfigDeps } from "./types.ts";

/** The declared config fields of a plugin, or a 404 if it does not exist. */
export async function loadConfigFields(
  deps: PluginConfigDeps,
  pluginName: string,
): Promise<PluginConfigField[]> {
  const fields = deps.resolveFields
    ? await deps.resolveFields(pluginName)
    : deps.hive.getPlugin(pluginName)?.configFields ?? (
      deps.hive.getPlugin(pluginName) ? [] : undefined
    );
  if (!fields) throw new AppError("Plugin not found.", 404);
  return fields;
}
