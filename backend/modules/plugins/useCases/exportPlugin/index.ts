import { join } from "node:path";
import { homeDir } from "hive-ai";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { zipTsFolder } from "../../../../core/microkernel/drafts/zip-folder.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

// Writes the zip to disk instead of streaming it as a download response:
// the app runs inside an embedded webview (Deno Desktop, WebKitGTK on
// Linux), where `<a download>` + blob URLs are unreliable and can fail
// silently with no error the frontend can catch. Same pattern already used
// by saveTestResults for the same reason.
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

  const downloadsDir = join(homeDir!, "Downloads");
  await Deno.mkdir(downloadsDir, { recursive: true });
  const filePath = join(downloadsDir, `${name}.zip`);
  await Deno.writeFile(filePath, new Uint8Array(await zipBlob.arrayBuffer()));

  return ResponseBuilder.success({ path: filePath }, { headers });
}
