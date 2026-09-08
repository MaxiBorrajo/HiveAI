import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export function deactivatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
): boolean {
  return hive.deactivate(pluginName);
}

export function handleDeactivatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
  headers: Record<string, string>,
): Response {
  const ok = deactivatePlugin(hive, pluginName);
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
