import { AppError } from "../../../core/api/errors.ts";
import type { PluginConfigDeps, PluginConfigFieldDto } from "../types.ts";

export function configId(pluginName: string, key: string): string {
  return `${pluginName}:${key}`;
}

export async function getPluginConfig(
  deps: PluginConfigDeps,
  pluginName: string,
): Promise<PluginConfigFieldDto[]> {
  const plugin = deps.hive.getPlugin(pluginName);
  if (!plugin) throw new AppError("Plugin not found.", 404);

  const fields = plugin.configFields ?? [];
  if (fields.length === 0) return [];

  const rows = await deps.repo.findByPlugin(pluginName);
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  return Promise.all(
    fields.map(async (field): Promise<PluginConfigFieldDto> => {
      const row = rowByKey.get(field.key);
      const secret = field.secret ?? true;
      if (!row) {
        return {
          key: field.key,
          label: field.label,
          secret,
          masked: null,
          value: null,
        };
      }
      if (secret) {
        return {
          key: field.key,
          label: field.label,
          secret,
          masked: `••••${row.last4}`,
          value: null,
        };
      }
      const value = await deps.secrets.get(configId(pluginName, field.key));
      return {
        key: field.key,
        label: field.label,
        secret,
        masked: null,
        value: value ?? null,
      };
    }),
  );
}
