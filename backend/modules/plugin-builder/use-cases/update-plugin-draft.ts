import { join } from "node:path";
import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { validateDraft, writeDraftToDir } from "../../../core/ai/plugin-builder/plugin-validator.ts";
import type { PluginDraft } from "../../../core/ai/plugin-builder/types.ts";
import { stagingDirFor } from "./generate-plugin-draft.ts";

export async function updatePluginDraft(
  hive: HiveMicrokernel,
  sessionId: string,
  draft: PluginDraft | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  if (!draft) {
    return ResponseBuilder.error(["Missing 'draft' in request body."], undefined, {
      status: 400,
      headers,
    });
  }

  const stagingDir = stagingDirFor(sessionId);
  const report = await validateDraft(hive, draft, stagingDir);
  const sourceCode = await writeDraftToDir(draft, stagingDir);
  await Deno.writeTextFile(
    join(stagingDir, "draft.json"),
    JSON.stringify(draft, null, 2),
  );

  return ResponseBuilder.success(
    { sessionId, draft, sourceCode, qualityReport: report.qualityReport, issues: report.issues },
    { headers },
  );
}
