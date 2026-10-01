import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { BeePlugin } from "../../../../core/microkernel/bee-plugin.ts";
import type { z } from "zod";
import type { PluginParameterDto } from "../../types.ts";
import type { GetPluginsResponse } from "./types.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

function describeParameters(plugin: BeePlugin): PluginParameterDto[] {
  const shape = (plugin.schema as { shape?: Record<string, z.ZodTypeAny> })
    ?.shape;
  return Object.entries(shape ?? {}).map(([name, field]) => ({
    name,
    required: !field.safeParse(undefined).success,
    description: field.description,
  }));
}

export function getPlugins(hive: HiveMicrokernel): GetPluginsResponse {
  return hive
    .getRegisteredPlugins()
    .map((plugin: BeePlugin) => ({
      name: plugin.name,
      description: plugin.description,
      active: hive.isActive(plugin.name),
      selectionTests: plugin.selectionTests || [],
      executionTests: plugin.executionTests || [],
      isExternal: hive.isExternalPlugin(plugin.name),
      parameters: describeParameters(plugin),
    }))
    .sort((a, b) => {
      if (a.name < b.name) {
        return -1;
      }
      if (a.name > b.name) {
        return 1;
      }
      return 0;
    });
}

export function handleGetPlugins(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Response {
  const plugins = getPlugins(hive);
  return ResponseBuilder.success(plugins, { headers });
}
