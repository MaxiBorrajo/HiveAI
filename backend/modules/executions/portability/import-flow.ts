import { dirname, join, resolve, sep } from "node:path";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { syncStateSchema } from "../../../core/ai/visual-builder/graph-factory.ts";
import { validateGraph } from "../../../core/ai/visual-builder/validation/validate-graph.ts";
import type { PluginInfo } from "../../../core/ai/visual-builder/types.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { describeInstalledPlugins } from "../use-cases/generate-execution/describe-plugins.ts";
import { persistValidatedGraph } from "../use-cases/update-execution-graph.ts";
import { checkPluginConformance } from "../../../core/microkernel/plugin-conformance.ts";
import {
  type BundledPlugin,
  type FlowFile,
  MAX_PLUGIN_BYTES,
  type ParsedFlow,
  readFlowZip,
} from "./flow-format.ts";
import { collectRequiredPlugins } from "./plugin-refs.ts";
import { scanGraphForSecrets } from "./scan-secrets.ts";

export type ConflictChoice = "new" | "overwrite";

export interface ImportOptions {
  conflict?: ConflictChoice;
  installBundledPlugins?: string[];
}

function fail(
  headers: Record<string, string>,
  status: number,
  errors: string[],
  data?: unknown,
): Response {
  return ResponseBuilder.error(errors, data, { headers, status });
}

/** Installed plugins plus name-only stubs for missing ones, so a missing
 * plugin does not reject the flow: it is imported as a draft instead. */
function pluginsForValidation(
  hive: HiveMicrokernel,
  required: string[],
): PluginInfo[] {
  const installed = describeInstalledPlugins(hive);
  const known = new Set(installed.map((p) => p.name));
  const stubs = required
    .filter((n) => !known.has(n))
    .map((name) => ({ name, description: "" }));
  return [...installed, ...stubs];
}

async function readUpload(
  bytes: Uint8Array | undefined,
): Promise<{ ok: true; parsed: ParsedFlow } | { ok: false; error: string }> {
  if (!bytes) return { ok: false, error: "No flow file was uploaded." };
  return await readFlowZip(bytes);
}

/** Writes a bundled plugin's sources to a temp dir (flat names, no bee-plugin.ts). */
async function withBundleDir<T>(
  bundle: BundledPlugin,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const total = Object.values(bundle.files).reduce((n, c) => n + c.length, 0);
  if (total > MAX_PLUGIN_BYTES) throw new Error("plugin is too large");
  if (!("index.ts" in bundle.files)) {
    throw new Error("missing required file index.ts");
  }

  const tempDir = await Deno.makeTempDir({ prefix: "hiveai-flow-plugin-" });
  try {
    const root = resolve(tempDir);
    for (const [fileName, content] of Object.entries(bundle.files)) {
      const dest = resolve(join(root, fileName));
      if (!dest.startsWith(root + sep)) {
        throw new Error(`invalid file name ${fileName}`);
      }
      await Deno.writeTextFile(dest, content);
    }
    return await fn(root);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

function validateImportedGraph(file: FlowFile, plugins: PluginInfo[]) {
  return validateGraph(syncStateSchema(file.graph), plugins);
}

export async function previewImport(
  db: AppDatabase,
  hive: HiveMicrokernel,
  bytes: Uint8Array | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  const read = await readUpload(bytes);
  if (!read.ok) return fail(headers, 400, [read.error]);
  const { file, bundledPlugins } = read.parsed;

  const repo = new ExecutionRepository(db);
  const existing = (await repo.findAll()).find((e) => e.name === file.name);

  const required = collectRequiredPlugins(file.graph);
  const missing = required.filter((n) => !hive.getPlugin(n));
  const inactive = required.filter(
    (n) => hive.getPlugin(n) && !hive.isActive(n),
  );

  const bundled = [];
  for (const bundle of bundledPlugins) {
    const installed = !!hive.getPlugin(bundle.name);
    let conformanceIssues: string[] = [];
    if (!installed) {
      try {
        conformanceIssues = await withBundleDir(
          bundle,
          async (dir) => (await checkPluginConformance(dir)).issues,
        );
      } catch (error) {
        conformanceIssues = [error instanceof Error ? error.message : String(error)];
      }
    }
    bundled.push({
      name: bundle.name,
      status: installed ? ("alreadyInstalled" as const) : ("missing" as const),
      files: bundle.files,
      conformanceIssues,
    });
  }
  const bundledNames = new Set(bundledPlugins.map((b) => b.name));

  const violations = validateImportedGraph(
    file,
    pluginsForValidation(hive, required),
  );

  return ResponseBuilder.success(
    {
      name: file.name,
      nameConflict: existing ? existing.id : null,
      missingPlugins: missing,
      unbundledMissingPlugins: missing.filter((n) => !bundledNames.has(n)),
      inactivePlugins: inactive,
      bundledPlugins: bundled,
      violations,
      secretWarnings: scanGraphForSecrets(file.graph),
    },
    { headers },
  );
}

async function installBundledPlugin(
  hive: HiveMicrokernel,
  bundle: BundledPlugin,
): Promise<void> {
  await withBundleDir(bundle, (dir) => hive.importExternalPlugin(dir));
}

export async function importFlow(
  db: AppDatabase,
  hive: HiveMicrokernel,
  bytes: Uint8Array | undefined,
  options: ImportOptions,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const read = await readUpload(bytes);
    if (!read.ok) return fail(headers, 400, [read.error]);
    const { file, bundledPlugins } = read.parsed;

    const repo = new ExecutionRepository(db);
    const existing = (await repo.findAll()).find((e) => e.name === file.name);
    if (existing && options.conflict !== "new" && options.conflict !== "overwrite") {
      return fail(
        headers,
        409,
        [`An execution named "${file.name}" already exists.`],
        { nameConflict: existing.id },
      );
    }

    // Validate before touching anything (plugins, executions).
    const required = collectRequiredPlugins(file.graph);
    const pluginInfos = pluginsForValidation(hive, required);
    const dryRun = validateImportedGraph(file, pluginInfos);
    if (dryRun.length > 0) {
      return fail(
        headers,
        422,
        dryRun.map((v) => v.reason),
        { violations: dryRun },
      );
    }

    // Only plugins that are missing are installed; a local plugin with the same
    // name is never replaced.
    const pluginResults: { name: string; installed: boolean; error?: string }[] =
      [];
    for (const name of options.installBundledPlugins ?? []) {
      const bundle = bundledPlugins.find((b) => b.name === name);
      if (!bundle || hive.getPlugin(name)) continue;
      try {
        await installBundledPlugin(hive, bundle);
        pluginResults.push({ name, installed: true });
      } catch (error) {
        pluginResults.push({
          name,
          installed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let targetName = file.name;
    if (existing && options.conflict === "new") {
      const names = new Set((await repo.findAll()).map((e) => e.name));
      targetName = `${file.name} (imported)`;
      for (let n = 2; names.has(targetName); n++) {
        targetName = `${file.name} (imported ${n})`;
      }
    }

    const now = Date.now();
    let executionId: number;
    let lastGraphId: number | null = null;
    if (existing && options.conflict === "overwrite") {
      executionId = existing.id;
      lastGraphId = existing.lastGraphId ?? null;
      await repo.update(executionId, { updatedAt: now });
    } else {
      const created = await repo.create({
        name: targetName,
        createdAt: now,
        updatedAt: now,
      });
      executionId = created.id;
    }

    const saved = await persistValidatedGraph(
      repo,
      { id: executionId, lastGraphId },
      file.graph,
      undefined,
      {
        availablePlugins: pluginsForValidation(hive, required),
        orchestrator: file.orchestrator ?? null,
      },
    );
    if (!saved.ok) {
      if (!(existing && options.conflict === "overwrite")) {
        await repo.delete(executionId).catch(() => {});
      }
      return fail(headers, 422, saved.violations.map((v) => v.reason), {
        violations: saved.violations,
      });
    }

    const missingPlugins = required.filter((n) => !hive.getPlugin(n));
    return ResponseBuilder.success(
      {
        executionId,
        name: targetName,
        isDraft: missingPlugins.length > 0,
        missingPlugins,
        inactivePlugins: required.filter(
          (n) => hive.getPlugin(n) && !hive.isActive(n),
        ),
        plugins: pluginResults,
      },
      { headers, status: 201 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(headers, 500, [`Failed to import execution: ${detail}`]);
  }
}
