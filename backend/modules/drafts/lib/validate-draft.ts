import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import {
  ExternalPluginProcessError,
} from "../../../core/microkernel/external-plugins/external-plugin-host.ts";
import {
  checkPluginConformance,
  syncBeePluginFile,
} from "../../../core/microkernel/plugin-conformance.ts";

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

  if (!(await fileExists(join(draftDir, "index.ts")))) {
    return { valid: false, issues: ["Missing index.ts."] };
  }
  // The draft always runs against this installation's BeePlugin interface.
  await syncBeePluginFile(draftDir);

  const draftIndex = await readFile(join(draftDir, "index.ts"), "utf-8");
  const badZodImport = draftIndex.match(/from\s+["'](npm:zod[^"']*|jsr:@?zod[^"']*|https?:\/\/[^"']*\bzod\b[^"']*)["']/);
  if (badZodImport) {
    issues.push(
      `index.ts imports zod from "${badZodImport[1]}" instead of the bare "zod" specifier. This loads a second, incompatible copy of the library and will crash the plugin loader at runtime. Change it to exactly: import { z } from "zod";`,
    );
    return { valid: false, issues };
  }

  const conformance = await checkPluginConformance(draftDir);
  if (!conformance.ok) return { valid: false, issues: conformance.issues };

  let handle;
  try {
    // Goes through the hive so the subprocess gets the callback URL
    // (plugin config and approvals work from the first load).
    handle = await hive.probeExternalPlugin(draftDir);
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
    await handle.stop();
  }
}
