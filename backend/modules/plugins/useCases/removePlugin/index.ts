import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";

export async function handleRemovePlugin(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  if (!hive.isExternalPlugin(name)) {
    return Response.json(
      { error: `'${name}' is not an imported (external) plugin, or is not registered.` },
      { status: 404, headers },
    );
  }

  const removed = await hive.removeExternalPlugin(name);
  return Response.json({ success: removed }, { headers, status: removed ? 200 : 404 });
}
