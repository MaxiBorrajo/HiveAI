import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { zipTsFolder } from "../../../../core/microkernel/drafts/zip-folder.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

// Exports an already-imported external plugin as a .zip, so it can be
// shared with someone else and re-imported on another machine through the
// ordinary "Import Plugin" folder-upload flow. Built-in plugins aren't
// exportable this way — they ship with the app itself, not as a
// user-imported folder.
export async function handleExportPlugin(
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

  const zipBlob = await zipTsFolder(dir, name);

  return new Response(zipBlob, {
    headers: {
      ...headers,
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}.zip"`,
    },
  });
}
