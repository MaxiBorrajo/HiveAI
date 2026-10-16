import { AppError } from "../../../core/api/errors.ts";
import type { PluginConfigDeps } from "../types.ts";
import { configId } from "./get-plugin-config.ts";

export async function setPluginConfig(
  deps: PluginConfigDeps,
  pluginName: string,
  key: string,
  value: unknown,
): Promise<void> {
  const plugin = deps.hive.getPlugin(pluginName);
  if (!plugin) throw new AppError("Plugin not found.", 404);

  const field = plugin.configFields?.find((f) => f.key === key);
  if (!field) {
    throw new AppError(
      `Plugin '${pluginName}' does not declare a config field named '${key}'.`,
      400,
    );
  }

  const cleanValue = typeof value === "string" ? value.trim() : "";
  if (!cleanValue) throw new AppError("A value is required.", 400);

  const id = configId(pluginName, key);
  await deps.secrets.put(id, cleanValue);

  const now = Date.now();
  const existing = await deps.repo.findOne(pluginName, key);
  await deps.repo.upsert({
    id,
    pluginName,
    key,
    last4: cleanValue.slice(-4),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  await deps.hive.restartExternalPlugin(pluginName);
}
