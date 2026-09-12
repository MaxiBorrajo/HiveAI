import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export function deactivatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
): Promise<boolean> {
  return hive.deactivate(pluginName);
}

export async function handleDeactivatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
  headers: Record<string, string>,
): Promise<Response> {
  const ok = await deactivatePlugin(hive, pluginName);
  if (ok) {
    return ResponseBuilder.success(undefined, { headers });
  } else {
    return ResponseBuilder.error(
      [`Plugin ${pluginName} not found or could not be deactivated`],
      undefined,
      { headers, status: 404 },
    );
  }
}
