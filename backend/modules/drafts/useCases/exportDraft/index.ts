import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { zipTsFolder } from "../../../../core/microkernel/drafts/zip-folder.ts";
import { getDraftRepository } from "../../draft-context.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

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

  return new Response(zipBlob, {
    headers: {
      ...headers,
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}.zip"`,
    },
  });
}
