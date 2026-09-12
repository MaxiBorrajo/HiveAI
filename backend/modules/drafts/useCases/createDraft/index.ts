import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { scaffoldDraftPlugin } from "../../../../core/microkernel/drafts/scaffold.ts";
import { getDraftsDir, getDraftRepository } from "../../draft-context.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { parseJsonBody } from "../../../../core/api/request.ts";

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

export async function handleCreateDraft(
  hive: HiveMicrokernel,
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const parsed = await parseJsonBody<{ name?: string }>(req, headers);
  if ("errorResponse" in parsed) return parsed.errorResponse;

  const name = parsed.body.name?.trim();
  if (!name || !NAME_PATTERN.test(name)) {
    return ResponseBuilder.error(
      [
        "Plugin name must be lowercase, start with a letter, and contain only letters, numbers, '-' or '_'.",
      ],
      undefined,
      { status: 400, headers },
    );
  }

  const repository = getDraftRepository(hive);
  if (await repository.get(name)) {
    return ResponseBuilder.error(
      [`A draft named '${name}' already exists.`],
      undefined,
      { status: 409, headers },
    );
  }

  const { dir } = await scaffoldDraftPlugin(getDraftsDir(hive), name);
  const now = new Date().toISOString();
  await repository.save({ name, dir, createdAt: now, updatedAt: now });

  return ResponseBuilder.success({ name, dir }, { headers });
}
