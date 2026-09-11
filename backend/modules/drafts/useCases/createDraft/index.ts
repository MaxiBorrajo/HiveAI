import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { scaffoldDraftPlugin } from "../../../../core/microkernel/drafts/scaffold.ts";
import { getDraftsDir, getDraftRepository } from "../../draft-context.ts";

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

export async function handleCreateDraft(
  hive: HiveMicrokernel,
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400, headers });
  }

  const name = body.name?.trim();
  if (!name || !NAME_PATTERN.test(name)) {
    return Response.json(
      { error: "Plugin name must be lowercase, start with a letter, and contain only letters, numbers, '-' or '_'." },
      { status: 400, headers },
    );
  }

  const repository = getDraftRepository(hive);
  if (await repository.get(name)) {
    return Response.json(
      { error: `A draft named '${name}' already exists.` },
      { status: 409, headers },
    );
  }

  const { dir } = await scaffoldDraftPlugin(getDraftsDir(hive), name);
  const now = new Date().toISOString();
  await repository.save({ name, dir, createdAt: now, updatedAt: now });

  return Response.json({ name, dir }, { headers });
}
