import { readPluginSourceFiles } from "../../../core/files/plugin-source-files.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { getDraftRepository } from "../lib/draft-context.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";

export async function handleGetDraftFiles(
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

  const files = await readPluginSourceFiles(record.dir);

  return ResponseBuilder.success({ files }, { headers });
}
