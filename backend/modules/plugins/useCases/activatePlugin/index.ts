import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";

export function activatePlugin(hive: HiveMicrokernel, pluginName: string): Promise<boolean> {
  return hive.activate(pluginName);
}

export async function handleActivatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
  headers: Record<string, string>,
): Promise<Response> {
  const ok = await activatePlugin(hive, pluginName);
  return Response.json(
    { success: ok },
    { headers, status: ok ? 200 : 404 },
  );
}

