import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { BeePlugin } from "../../../../core/microkernel/bee-plugin.ts";
import type { GetPluginsResponse } from "./types.ts";

export function getPlugins(hive: HiveMicrokernel): GetPluginsResponse {
  return hive.getRegisteredPlugins().map((plugin: BeePlugin) => ({
    name: plugin.name,
    description: plugin.description,
    active: hive.isActive(plugin.name),
    testCases: plugin.testCases || [],
  }));
}

export function handleGetPlugins(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Response {
  const plugins = getPlugins(hive);
  return Response.json(plugins, { headers });
}

