import { join } from "node:path";
import { rename } from "node:fs/promises";
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

  const sourceDir = await hive.detachExternalPluginForEdit(name);
  if (!sourceDir) {
    return ResponseBuilder.error(
      [`Could not detach plugin '${name}'.`],
      undefined,
      { status: 404, headers },
    );
  }

  const draftDir = join(getDraftsDir(hive), name);
  await rename(sourceDir, draftDir);

  const now = new Date().toISOString();
  await getDraftRepository(hive).save({
    name,
    dir: draftDir,
    createdAt: now,
    updatedAt: now,
  });

  return ResponseBuilder.success({ name, dir: draftDir }, { headers });
}
