import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { readPluginSourceFiles } from "../../../core/files/plugin-source-files.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";

/** Source of an installed (external) plugin, for the read-only editor view. */
export async function handleGetPluginFiles(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  const dir = await hive.getExternalPluginDir(name);
  if (!dir) {
    return ResponseBuilder.error(
      ["Plugin not found or not an imported (external) plugin."],
      undefined,
      { status: 404, headers },
    );
  }
  const files = await readPluginSourceFiles(dir);
  return ResponseBuilder.success({ files }, { headers });
}
