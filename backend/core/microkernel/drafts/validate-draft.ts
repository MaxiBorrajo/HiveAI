// Live validation for a draft plugin folder being edited in-app — run on
// every save so the user sees whether they're "on the right track" instead
// of finding out only when they try to import.
//
// This launches the same subprocess runner used for a real import (briefly,
// then kills it) rather than reconstructing structural/test-count checks
// separately — that keeps validation logic in exactly one place
// (HiveMicrokernel.validatePlugin) instead of two copies drifting apart.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HiveMicrokernel } from "../hive-microkernel.ts";
import {
  launchExternalPlugin,
  ExternalPluginProcessError,
} from "../external-plugins/external-plugin-host.ts";
import { externalPluginNameFromSourceDir } from "../external-plugins/external-plugin-registry.ts";

export interface DraftValidationResult {
  valid: boolean;
  issues: string[];
  counts?: Record<string, number>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function validateDraftPlugin(
  hive: HiveMicrokernel,
  draftDir: string,
): Promise<DraftValidationResult> {
  const issues: string[] = [];

  const hasIndex = await fileExists(join(draftDir, "index.ts"));
  const hasBeePlugin = await fileExists(join(draftDir, "bee-plugin.ts"));
  if (!hasIndex) issues.push("Missing index.ts.");
  if (!hasBeePlugin) issues.push("Missing bee-plugin.ts.");
  if (!hasIndex || !hasBeePlugin) {
    return { valid: false, issues };
  }

  const coreBeePlugin = await readFile(
    new URL("../bee-plugin.ts", import.meta.url),
    "utf-8",
  );
  const draftBeePlugin = await readFile(
    join(draftDir, "bee-plugin.ts"),
    "utf-8",
  );
  if (coreBeePlugin.trim() !== draftBeePlugin.trim()) {
    issues.push(
      "bee-plugin.ts has been modified — it must match the microkernel's version exactly. Regenerate the draft or copy the original back in.",
    );
    return { valid: false, issues };
  }

  let handle;
  try {
    handle = await launchExternalPlugin(externalPluginNameFromSourceDir(draftDir), draftDir);
  } catch (error) {
    if (error instanceof ExternalPluginProcessError) {
      issues.push(`Plugin code failed to load: ${error.message}`);
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      issues.push(`Plugin code failed to load: ${detail}`);
    }
    return { valid: false, issues };
  }

  try {
    const report = hive.validatePlugin(handle.plugin);
    return {
      valid: report.valid,
      issues: report.issues,
      counts: report.counts,
    };
  } finally {
    // Doesn't call stopSharedHostIfIdle here — HiveMicrokernel is the one
    // that knows whether any real external plugin is still active, and it
    // already calls that after its own activate/deactivate/import/remove
    // flows. Worst case the shared host briefly stays up with nothing
    // loaded until the next one of those runs.
    await handle.stop();
  }
}
