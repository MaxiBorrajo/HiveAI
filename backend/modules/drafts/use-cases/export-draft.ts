import { join } from "node:path";
import { homeDir } from "../../../core/env.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { zipTsFolder } from "../../../core/files/zip-folder.ts";
import { getDraftRepository } from "../lib/draft-context.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";

export async function handleExportDraft(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  const record = await getDraftRepository(hive).get(name);
  if (!record) {
    return ResponseBuilder.error(["Draft not found."], undefined, {
      status: 404,
      headers,
    });
  }

  const zipBlob = await zipTsFolder(record.dir, name);

  const downloadsDir = join(homeDir!, "Downloads");
  await Deno.mkdir(downloadsDir, { recursive: true });
  const filePath = join(downloadsDir, `${name}.zip`);
  await Deno.writeFile(filePath, new Uint8Array(await zipBlob.arrayBuffer()));

  return ResponseBuilder.success({ path: filePath }, { headers });
}
