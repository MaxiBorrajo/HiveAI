import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { getDraftRepository } from "../../draft-context.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

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

  const entries = await readdir(record.dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map(async (e) => ({
        name: e.name,
        content: await readFile(join(record.dir, e.name), "utf-8"),
      })),
  );

  return ResponseBuilder.success({ files }, { headers });
}
