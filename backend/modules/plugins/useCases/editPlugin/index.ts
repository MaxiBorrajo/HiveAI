import { join } from "node:path";
import { mkdir, rename } from "node:fs/promises";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import {
  getDraftsDir,
  getDraftRepository,
} from "../../../drafts/draft-context.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export async function handleEditPlugin(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  if (!hive.isExternalPlugin(name)) {
    return ResponseBuilder.error(
      [`'${name}' is not an imported (external) plugin, or is not registered.`],
      undefined,
      { status: 404, headers },
    );
  }

  // getDraftsDir() never creates the directory it points to — make sure it
  // exists before detaching the plugin, since detach unregisters it from the
  // microkernel and forgets its persisted record regardless of whether the
  // rename below succeeds. Detaching isn't easily reversible (it already
  // stopped the subprocess), so the safest order is to remove the one
  // preventable cause of the rename failing first.
  await mkdir(getDraftsDir(hive), { recursive: true });

  const sourceDir = await hive.detachExternalPluginForEdit(name);
  if (!sourceDir) {
    return ResponseBuilder.error(
      [`Could not detach plugin '${name}'.`],
      undefined,
      { status: 404, headers },
    );
  }

  const draftDir = join(getDraftsDir(hive), name);

  try {
    await rename(sourceDir, draftDir);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [
        `Plugin '${name}' was detached but its files could not be moved to the drafts folder: ${detail}. Its code is still on disk at '${sourceDir}', but it is no longer an active plugin — it will need to be re-imported manually.`,
      ],
      undefined,
      { status: 500, headers },
    );
  }

  const now = new Date().toISOString();
  await getDraftRepository(hive).save({
    name,
    dir: draftDir,
    createdAt: now,
    updatedAt: now,
  });

  return ResponseBuilder.success({ name, dir: draftDir }, { headers });
}
