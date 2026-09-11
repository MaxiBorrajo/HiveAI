import { join } from "node:path";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { JsonDraftPluginRepository } from "../../core/microkernel/drafts/draft-plugin-repository.ts";

// Kept separate from HiveMicrokernel (unlike ExternalPluginRegistry) since
// drafts are an editing/staging concern the microkernel itself never needs
// to know about — it only ever sees a draft once importDraft hands it a
// finished folder via the ordinary importExternalPlugin path.
export function getDraftsDir(hive: HiveMicrokernel): string {
  return join(hive.getConfig().get("dataDir"), "drafts");
}

export function getDraftRepository(hive: HiveMicrokernel): JsonDraftPluginRepository {
  return new JsonDraftPluginRepository(getDraftsDir(hive));
}
