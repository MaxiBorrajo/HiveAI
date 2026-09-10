import { join } from "node:path";
import { rename } from "node:fs/promises";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { getDraftsDir, getDraftRepository } from "../../../drafts/draft-context.ts";

// Turns an already-imported external plugin back into an editable draft:
// deactivates it (killing its subprocess if running), drops it from the
// external-plugins registry, and moves its folder as-is into the drafts
// directory — reusing the same in-app editor, live validation, and import
// flow a brand-new plugin goes through, instead of a separate "edit in
// place" mode for already-active code. The plugin stops being registered
// (and stops appearing to the selector) the moment this runs; it only comes
// back once the user re-imports the draft.
export async function handleEditPlugin(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  if (!hive.isExternalPlugin(name)) {
    return Response.json(
      { error: `'${name}' is not an imported (external) plugin, or is not registered.` },
      { status: 404, headers },
    );
  }

  const sourceDir = await hive.detachExternalPluginForEdit(name);
  if (!sourceDir) {
    return Response.json({ error: `Could not detach plugin '${name}'.` }, { status: 404, headers });
  }

  const draftDir = join(getDraftsDir(hive), name);
  await rename(sourceDir, draftDir);

  const now = new Date().toISOString();
  await getDraftRepository(hive).save({ name, dir: draftDir, createdAt: now, updatedAt: now });

  return Response.json({ name, dir: draftDir }, { headers });
}
