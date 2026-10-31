import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import {
  launchExternalPlugin,
  ExternalPluginProcessError,
} from "../../../core/microkernel/external-plugins/external-plugin-host.ts";
import { externalPluginNameFromSourceDir } from "../../../core/microkernel/external-plugins/external-plugin-registry.ts";

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
    new URL("../../../core/microkernel/bee-plugin.ts", import.meta.url),
    "utf-8",
  );
  const draftBeePlugin = await readFile(
    join(draftDir, "bee-plugin.ts"),
    "utf-8",
  );
  const normalizeEol = (text: string) => text.replace(/\r\n/g, "\n").trim();
  if (normalizeEol(coreBeePlugin) !== normalizeEol(draftBeePlugin)) {
    issues.push(
      "bee-plugin.ts has been modified — it must match the microkernel's version exactly. Regenerate the draft or copy the original back in.",
    );
    return { valid: false, issues };
  }

  const draftIndex = await readFile(join(draftDir, "index.ts"), "utf-8");
  const badZodImport = draftIndex.match(/from\s+["'](npm:zod[^"']*|jsr:@?zod[^"']*|https?:\/\/[^"']*\bzod\b[^"']*)["']/);
  if (badZodImport) {
    issues.push(
      `index.ts imports zod from "${badZodImport[1]}" instead of the bare "zod" specifier. This loads a second, incompatible copy of the library and will crash the plugin loader at runtime. Change it to exactly: import { z } from "zod";`,
    );
    return { valid: false, issues };
  }

  let handle;
  try {
    handle = await launchExternalPlugin(
      externalPluginNameFromSourceDir(draftDir),
      draftDir,
    );
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
