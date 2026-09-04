import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";

export function deactivatePlugin(hive: HiveMicrokernel, pluginName: string): boolean {
  return hive.deactivate(pluginName);
}

export function handleDeactivatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
  headers: Record<string, string>,
): Response {
  const ok = deactivatePlugin(hive, pluginName);
  return Response.json(
    { success: ok },
    { headers, status: ok ? 200 : 404 },
  );
}

