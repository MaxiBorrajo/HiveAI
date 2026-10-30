import { join } from "node:path";
import { HiveMicrokernel } from "../../microkernel/hive-microkernel.ts";
import { validatePlugin } from "../../microkernel/plugin-quality-validator.ts";
import { serializePluginDraft } from "./code-serializer.ts";
import type { DraftValidationReport, PluginDraft } from "./types.ts";

const BEE_PLUGIN_SOURCE_URL = new URL(
  "../../microkernel/bee-plugin.ts",
  import.meta.url,
);

export async function writeDraftToDir(
  draft: PluginDraft,
  dir: string,
): Promise<string> {
  const sourceCode = serializePluginDraft(draft);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "index.ts"), sourceCode);
  const beePluginContent = await Deno.readTextFile(BEE_PLUGIN_SOURCE_URL);
  await Deno.writeTextFile(join(dir, "bee-plugin.ts"), beePluginContent);
  return sourceCode;
}

/**
 * Writes the draft to `dir`, launches it as a throwaway external-plugin
 * probe (real compile + load, no registry writes), and runs the quality
 * validator against the actually-loaded plugin object.
 */
export async function validateDraft(
  hive: HiveMicrokernel,
  draft: PluginDraft,
  dir: string,
): Promise<DraftValidationReport> {
  await writeDraftToDir(draft, dir);

  let probe: Awaited<ReturnType<HiveMicrokernel["probeExternalPlugin"]>>;
  try {
    probe = await hive.probeExternalPlugin(dir);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { valid: false, compileError: detail, issues: [detail] };
  }

  try {
    const qualityReport = validatePlugin(probe.plugin);
    return {
      valid: qualityReport.valid,
      qualityReport,
      issues: qualityReport.issues,
    };
  } finally {
    await probe.stop();
  }
}
