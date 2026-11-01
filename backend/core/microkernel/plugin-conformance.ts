import { join } from "node:path";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";

const BEE_PLUGIN_URL = new URL("./bee-plugin.ts", import.meta.url);
const BACKEND_DENO_JSON_URL = new URL("../../deno.json", import.meta.url);
const FALLBACK_ZOD_SPECIFIER = "npm:zod@^4.4.3";
const CHECK_TIMEOUT_MS = 120_000;
const MAX_REPORTED_CHARS = 2500;

/** Single source of truth for the fields every plugin must expose at runtime. */
export function assertPluginShape(instance: unknown): void {
  const fail = (detail: string): never => {
    throw new TypeError(
      `The plugin does not fulfill the BeePlugin contract: ${detail}.`,
    );
  };
  if (!instance || typeof instance !== "object") {
    fail("the default export did not produce an object");
  }
  const plugin = instance as Record<string, unknown>;

  for (const field of ["name", "description"] as const) {
    if (!(field in plugin)) fail(`missing '${field}'`);
    if (typeof plugin[field] !== "string" || !plugin[field]) {
      fail(`'${field}' must be a non-empty string`);
    }
  }
  if (!("schema" in plugin)) fail("missing 'schema'");
  const schema = plugin.schema as { safeParse?: unknown } | null;
  if (!schema || typeof schema.safeParse !== "function") {
    fail("'schema' must be a zod schema");
  }
  if (!("process" in plugin)) fail("missing 'process'");
  if (typeof plugin.process !== "function") fail("'process' must be a function");
  for (const field of ["selectionTests", "executionTests"] as const) {
    if (!(field in plugin)) fail(`missing '${field}'`);
    if (!Array.isArray(plugin[field])) fail(`'${field}' must be an array`);
  }
  for (const field of ["initialize", "dispose"] as const) {
    if (field in plugin && typeof plugin[field] !== "function") {
      fail(`'${field}' must be a function`);
    }
  }
  if ("configFields" in plugin && plugin.configFields !== undefined) {
    if (!Array.isArray(plugin.configFields)) fail("'configFields' must be an array");
  }
}

/**
 * Plugins always run against the BeePlugin interface of this installation:
 * the file is never taken from an import. Writes the current one into `dir`.
 */
export async function syncBeePluginFile(dir: string): Promise<void> {
  await copyFile(BEE_PLUGIN_URL, join(dir, "bee-plugin.ts"));
}

/**
 * Class fields like `selectionTests = [{ kind: "positive", ... }]` widen
 * `kind` to `string`, which strict TypeScript rejects even though the plugin
 * is perfectly valid (the scaffold and the AI skeleton produce exactly that).
 * The check therefore runs against a copy where the two `kind` unions are plain
 * strings; the allowed values are still enforced at runtime by the quality
 * validator, which needs a minimum count of every kind.
 */
async function relaxTestKindLiterals(beePluginPath: string): Promise<void> {
  const source = await readFile(beePluginPath, "utf-8");
  const relaxed = source.replace(
    /export type (SelectionCaseKind|ExecutionTestKind) =[^;]+;/g,
    "export type $1 = string;",
  );
  if (relaxed !== source) await writeFile(beePluginPath, relaxed);
}

async function resolveZodSpecifier(): Promise<string> {
  try {
    const config = JSON.parse(
      await readFile(BACKEND_DENO_JSON_URL, "utf-8"),
    ) as { imports?: Record<string, string> };
    return config.imports?.zod ?? FALLBACK_ZOD_SPECIFIER;
  } catch {
    return FALLBACK_ZOD_SPECIFIER;
  }
}

function resolveDenoExecutable(): string {
  return Deno.env.get("HIVEAI_DENO_BIN") || "deno";
}

export interface ConformanceResult {
  ok: boolean;
  issues: string[];
}

export class PluginConformanceError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(" "));
  }
}

/**
 * Type-checks the plugin in `sourceDir` against the BeePlugin interface of this
 * installation. Works on a throwaway copy, so `sourceDir` is never modified.
 */
export async function checkPluginConformance(
  sourceDir: string,
): Promise<ConformanceResult> {
  const checkDir = await Deno.makeTempDir({ prefix: "hiveai-conformance-" });
  try {
    for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      await copyFile(join(sourceDir, entry.name), join(checkDir, entry.name));
    }
    await syncBeePluginFile(checkDir);
    await relaxTestKindLiterals(join(checkDir, "bee-plugin.ts"));

    try {
      await Deno.stat(join(checkDir, "index.ts"));
    } catch {
      return { ok: false, issues: ["Missing index.ts."] };
    }

    // Forces the default export to be assignable to BeePlugin even if the
    // class forgot to declare `implements BeePlugin`.
    await writeFile(
      join(checkDir, "conformance-check.ts"),
      `import type { BeePlugin } from "./bee-plugin.ts";
import Plugin from "./index.ts";
export const plugin: BeePlugin = new Plugin();
`,
    );
    await writeFile(
      join(checkDir, "deno.json"),
      JSON.stringify({ imports: { zod: await resolveZodSpecifier() } }),
    );

    let output: Deno.CommandOutput;
    try {
      output = await new Deno.Command(resolveDenoExecutable(), {
        args: [
          "check",
          "--no-lock",
          "--config",
          join(checkDir, "deno.json"),
          join(checkDir, "conformance-check.ts"),
        ],
        cwd: checkDir,
        env: { NO_COLOR: "1" },
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      }).output();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        issues: [`Could not run the type check for the plugin: ${detail}`],
      };
    }

    if (output.success) return { ok: true, issues: [] };

    const report = new TextDecoder()
      .decode(output.stderr)
      .replaceAll(checkDir, ".")
      .replaceAll(`file://${checkDir}`, ".")
      .trim();
    const shown = report.length > MAX_REPORTED_CHARS
      ? `${report.slice(0, MAX_REPORTED_CHARS)}\n…`
      : report;
    return {
      ok: false,
      issues: [
        `The plugin does not match the BeePlugin interface of this version of HiveAI:\n${shown}`,
      ],
    };
  } finally {
    await Deno.remove(checkDir, { recursive: true }).catch(() => {});
  }
}
