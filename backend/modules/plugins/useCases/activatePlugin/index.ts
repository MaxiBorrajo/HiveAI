import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export function activatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
): Promise<boolean> {
  return hive.activate(pluginName);
}

export async function handleActivatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
  headers: Record<string, string>,
): Promise<Response> {
  const ok = await activatePlugin(hive, pluginName);
  if (ok) {
    return ResponseBuilder.success("Plugin activated", { headers });
  } else {
    return ResponseBuilder.error(
      [`Plugin ${pluginName} not found or could not be activated`],
      undefined,
      { headers, status: 404 },
    );
  }
}
