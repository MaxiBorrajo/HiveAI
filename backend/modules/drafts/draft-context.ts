import { join } from "node:path";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { JsonDraftPluginRepository } from "../../core/microkernel/drafts/draft-plugin-repository.ts";

export function getDraftsDir(hive: HiveMicrokernel): string {
  return join(hive.getConfig().get("dataDir"), "drafts");
}

export function getDraftRepository(
  hive: HiveMicrokernel,
): JsonDraftPluginRepository {
  return new JsonDraftPluginRepository(getDraftsDir(hive));
}
