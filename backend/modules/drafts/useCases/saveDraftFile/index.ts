import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { getDraftRepository } from "../../draft-context.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { parseJsonBody } from "../../../../core/api/request.ts";

const EDITABLE_FILES = new Set(["index.ts"]);

export async function handleSaveDraftFile(
  hive: HiveMicrokernel,
  name: string,
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const record = await getDraftRepository(hive).get(name);
  if (!record) {
    return ResponseBuilder.error(["Draft not found."], undefined, {
      status: 404,
      headers,
    });
  }

  const parsed = await parseJsonBody<{ file?: string; content?: string }>(
    req,
    headers,
  );
  if ("errorResponse" in parsed) return parsed.errorResponse;
  const body = parsed.body;

  if (!body.file || !EDITABLE_FILES.has(body.file)) {
    return ResponseBuilder.error(
      [`'file' must be one of: ${Array.from(EDITABLE_FILES).join(", ")}.`],
      undefined,
      { status: 400, headers },
    );
  }
  if (typeof body.content !== "string") {
    return ResponseBuilder.error(["'content' must be a string."], undefined, {
      status: 400,
      headers,
    });
  }

  await writeFile(join(record.dir, body.file), body.content, "utf-8");

  const repository = getDraftRepository(hive);
  await repository.save({ ...record, updatedAt: new Date().toISOString() });

  return ResponseBuilder.success(undefined, { headers });
}
