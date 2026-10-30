import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { executeSelectionTest } from "../../plugins/use-cases/test-plugin/test-plugin.ts";
import { stagingDirFor } from "./generate-plugin-draft.ts";
import type { PluginSelectionTestDraft } from "../../../core/ai/plugin-builder/types.ts";

export type DraftTestKind = "selection" | "execution";

export async function runDraftTest(
  hive: HiveMicrokernel,
  model: string,
  sessionId: string,
  kind: DraftTestKind,
  index: number,
  signal: AbortSignal,
  headers: Record<string, string>,
): Promise<Response> {
  if (!Number.isInteger(index) || index < 0) {
    return ResponseBuilder.error(["Invalid test index"], undefined, {
      status: 400,
      headers,
    });
  }
  if (kind !== "selection" && kind !== "execution") {
    return ResponseBuilder.error(["Invalid test kind"], undefined, {
      status: 400,
      headers,
    });
  }

  const stagingDir = stagingDirFor(sessionId);

  try {
    await Deno.stat(`${stagingDir}/index.ts`);
  } catch {
    return ResponseBuilder.error(
      ["No generated plugin draft was found for this session."],
      undefined,
      { status: 404, headers },
    );
  }

  if (kind === "execution") {
    return runExecutionDraftTest(hive, stagingDir, index, headers);
  }
  return runSelectionDraftTest(hive, model, stagingDir, index, signal, headers);
}

async function runExecutionDraftTest(
  hive: HiveMicrokernel,
  stagingDir: string,
  index: number,
  headers: Record<string, string>,
): Promise<Response> {
  const probe = await hive.probeExternalPlugin(stagingDir);
  try {
    const result = await probe.runExecutionTest(index);
    if (result.success) {
      return ResponseBuilder.success(
        { output: result.output },
        { headers },
      );
    }
    return ResponseBuilder.error(
      [result.error ?? `Output did not meet expectations: ${result.output}`],
      { output: result.output },
      { headers },
    );
  } finally {
    await probe.stop();
  }
}

/**
 * Selection tests need the draft to be a real, visible tool to the LLM
 * agent (Scout picks from `hive.getTools()`), so it is briefly imported
 * and activated against the staging dir, then removed again in `finally`.
 * Note: importExternalPlugin persists to the external-plugins registry
 * immediately (not just in-memory), so a crash between import and the
 * `finally` below would leave an orphaned entry named after the staging
 * session's uuid — harmless (never collides with a real plugin name) but
 * worth knowing if that registry is inspected directly.
 */
async function runSelectionDraftTest(
  hive: HiveMicrokernel,
  model: string,
  stagingDir: string,
  index: number,
  signal: AbortSignal,
  headers: Record<string, string>,
): Promise<Response> {
  const plugin = await hive.importExternalPlugin(stagingDir);
  try {
    const testCase = plugin.selectionTests[index] as
      | PluginSelectionTestDraft
      | undefined;
    if (!testCase) {
      return ResponseBuilder.error(["Test not found"], undefined, {
        status: 404,
        headers,
      });
    }

    await hive.activate(plugin.name);
    try {
      return await executeSelectionTest(testCase, model, plugin.name, signal);
    } finally {
      await hive.deactivate(plugin.name).catch(() => {});
    }
  } finally {
    await hive.removeExternalPlugin(plugin.name).catch(() => {});
  }
}
