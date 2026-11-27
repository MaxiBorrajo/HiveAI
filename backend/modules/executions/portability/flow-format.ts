import { z } from "zod";
import {
  pluginFilesFromEntries,
  readZip,
  ZipReadError,
} from "../../../core/files/zip-folder.ts";
import type { LangGraphAbstraction } from "../../../core/ai/visual-builder/types.ts";

export const FORMAT_NAME = "hiveai-flow";
export const CURRENT_VERSION = 2;
export const FLOW_JSON_NAME = "flow.json";
export const PLUGINS_DIR = "plugins";
export const MAX_FILE_BYTES = 10 * 1024 * 1024; //10MB (whole zip, compressed or not)
export const MAX_PLUGIN_BYTES = 5 * 1024 * 1024; //5MB

const PLUGIN_FILE_NAME = /^[A-Za-z0-9_.-]+\.ts$/;

const PLUGIN_NAME = /^[A-Za-z0-9_.-]+$/;

const flowFileSchema = z.object({
  format: z.literal(FORMAT_NAME),
  formatVersion: z.number().int(),
  kind: z.literal("execution"),
  exportedAt: z.string().optional(),
  name: z.string().min(1),
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    stateSchema: z.any().optional(),
  }),
  orchestrator: z
    .object({ provider: z.string(), model: z.string() })
    .nullable()
    .optional(),
  requiredPlugins: z.array(
    z.object({ name: z.string().min(1), external: z.boolean() }),
  ),
});

export interface FlowFile {
  format: typeof FORMAT_NAME;
  formatVersion: number;
  kind: "execution";
  exportedAt?: string;
  name: string;
  graph: LangGraphAbstraction;
  orchestrator?: { provider: string; model: string } | null;
  requiredPlugins: { name: string; external: boolean }[];
}

/** Source of an external plugin carried inside a flow zip (never bee-plugin.ts). */
export interface BundledPlugin {
  name: string;
  files: Record<string, string>;
}

export interface ParsedFlow {
  file: FlowFile;
  bundledPlugins: BundledPlugin[];
}

export type ParseFlowResult =
  | { ok: true; file: FlowFile }
  | { ok: false; error: string };

export function parseFlowFile(raw: unknown): ParseFlowResult {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > MAX_FILE_BYTES) {
      return { ok: false, error: "The file is too large to be a HiveAI flow." };
    }
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        error: "The file is corrupted or is not valid JSON.",
      };
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "The file is not a HiveAI flow." };
  }
  const header = value as Record<string, unknown>;
  if (header.format !== FORMAT_NAME) {
    return {
      ok: false,
      error: `The file is not a HiveAI flow (expected format "${FORMAT_NAME}").`,
    };
  }
  if (header.formatVersion !== CURRENT_VERSION) {
    return {
      ok: false,
      error: `Unsupported format version ${
        String(header.formatVersion ?? "(missing)")
      }. This version of HiveAI supports version ${CURRENT_VERSION}; re-export the flow from the app that created it.`,
    };
  }

  const parsed = flowFileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".") || "(root)";
    return {
      ok: false,
      error: `The flow file is corrupted or incomplete: ${path}: ${issue.message}`,
    };
  }
  return { ok: true, file: parsed.data as FlowFile };
}

/**
 * Reads a `.hiveai-flow.zip`: `flow.json` at the root plus one
 * `plugins/<name>/` folder per bundled external plugin.
 */
export type ReadFlowZipResult =
  | { ok: true; parsed: ParsedFlow }
  | { ok: false; error: string };

export async function readFlowZip(
  bytes: Uint8Array,
): Promise<ReadFlowZipResult> {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, error: "The file is too large to be a HiveAI flow." };
  }

  let entries: Map<string, Uint8Array>;
  try {
    entries = await readZip(bytes, MAX_FILE_BYTES);
  } catch (error) {
    if (error instanceof ZipReadError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  const json = entries.get(FLOW_JSON_NAME);
  if (!json) {
    return {
      ok: false,
      error: `The zip is not a HiveAI flow (missing ${FLOW_JSON_NAME}).`,
    };
  }
  const result = parseFlowFile(new TextDecoder().decode(json));
  if (!result.ok) return result;

  const decoder = new TextDecoder();
  const names = new Set<string>();
  for (const path of entries.keys()) {
    const [dir, name, ...rest] = path.split("/");
    if (dir === PLUGINS_DIR && name && rest.length > 0) names.add(name);
  }

  const bundledPlugins: BundledPlugin[] = [];
  for (const name of names) {
    if (!PLUGIN_NAME.test(name)) {
      return { ok: false, error: `Invalid plugin folder name "${name}".` };
    }
    const raw = pluginFilesFromEntries(entries, `${PLUGINS_DIR}/${name}/`);
    const files: Record<string, string> = {};
    for (const [fileName, content] of Object.entries(raw)) {
      if (!PLUGIN_FILE_NAME.test(fileName)) {
        return { ok: false, error: `Invalid file name "${fileName}" in plugin "${name}".` };
      }
      files[fileName] = decoder.decode(content);
    }
    bundledPlugins.push({ name, files });
  }

  return { ok: true, parsed: { file: result.file, bundledPlugins } };
}
