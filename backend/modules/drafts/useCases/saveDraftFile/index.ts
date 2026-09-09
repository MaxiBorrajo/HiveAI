import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { getDraftRepository } from "../../draft-context.ts";

// Only index.ts is editable — bee-plugin.ts must stay byte-identical to the
// core contract (see validate-draft.ts), so letting the editor write to it
// would just recreate the "outdated bee-plugin.ts" failure the scaffold
// exists to prevent in the first place.
const EDITABLE_FILES = new Set(["index.ts"]);

export async function handleSaveDraftFile(
  hive: HiveMicrokernel,
  name: string,
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const record = await getDraftRepository(hive).get(name);
  if (!record) {
    return Response.json({ error: "Draft not found." }, { status: 404, headers });
  }

  let body: { file?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400, headers });
  }

  if (!body.file || !EDITABLE_FILES.has(body.file)) {
    return Response.json(
      { error: `'file' must be one of: ${Array.from(EDITABLE_FILES).join(", ")}.` },
      { status: 400, headers },
    );
  }
  if (typeof body.content !== "string") {
    return Response.json({ error: "'content' must be a string." }, { status: 400, headers });
  }

  await writeFile(join(record.dir, body.file), body.content, "utf-8");

  const repository = getDraftRepository(hive);
  await repository.save({ ...record, updatedAt: new Date().toISOString() });

  return Response.json({ success: true }, { headers });
}
