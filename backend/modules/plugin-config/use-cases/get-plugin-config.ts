import { loadConfigFields } from "../lib.ts";
import type { PluginConfigDeps, PluginConfigFieldDto } from "../types.ts";

export function configId(pluginName: string, key: string): string {
  return `${pluginName}:${key}`;
}

export async function getPluginConfig(
  deps: PluginConfigDeps,
  pluginName: string,
): Promise<PluginConfigFieldDto[]> {
  const fields = await loadConfigFields(deps, pluginName);
  if (fields.length === 0) return [];

  const rows = await deps.repo.findByPlugin(pluginName);
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  return Promise.all(
    fields.map(async (field): Promise<PluginConfigFieldDto> => {
      const row = rowByKey.get(field.key);
      const secret = field.secret ?? true;
      const base = {
        key: field.key,
        label: field.label,
        secret,
        ...(field.options ? { options: field.options } : {}),
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.description ? { description: field.description } : {}),
      };
      if (!row) return { ...base, masked: null, value: null };
      if (secret) return { ...base, masked: `••••${row.last4}`, value: null };
      const value = await deps.secrets.get(configId(pluginName, field.key));
      return { ...base, masked: null, value: value ?? null };
    }),
  );
}
