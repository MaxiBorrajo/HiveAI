import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";

export function activatePlugin(hive: HiveMicrokernel, pluginName: string): boolean {
  return hive.activate(pluginName);
}

export function handleActivatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
  headers: Record<string, string>,
): Response {
  const ok = activatePlugin(hive, pluginName);
  return Response.json(
    { success: ok },
    { headers, status: ok ? 200 : 404 },
  );
}

