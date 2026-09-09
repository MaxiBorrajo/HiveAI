import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";

export function deactivatePlugin(hive: HiveMicrokernel, pluginName: string): Promise<boolean> {
  return hive.deactivate(pluginName);
}

export async function handleDeactivatePlugin(
  hive: HiveMicrokernel,
  pluginName: string,
  headers: Record<string, string>,
): Promise<Response> {
  const ok = await deactivatePlugin(hive, pluginName);
  return Response.json(
    { success: ok },
    { headers, status: ok ? 200 : 404 },
  );
}

