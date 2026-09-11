import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export async function handleRemovePlugin(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  if (!hive.isExternalPlugin(name)) {
    return ResponseBuilder.error(
      [`'${name}' is not an imported (external) plugin, or is not registered.`],
      undefined,
      { status: 404, headers },
    );
  }

  const removed = await hive.removeExternalPlugin(name);
  if (!removed) {
    return ResponseBuilder.error(
      [`Could not remove plugin '${name}'.`],
      undefined,
      { status: 404, headers },
    );
  }
  return ResponseBuilder.success(undefined, { headers });
}
