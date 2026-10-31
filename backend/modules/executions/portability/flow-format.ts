import { z } from "zod";
import type { LangGraphAbstraction } from "../../../core/ai/visual-builder/types.ts";

export const FORMAT_NAME = "hiveai-flow";
export const CURRENT_VERSION = 1;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; //10MB
export const MAX_PLUGIN_BYTES = 5 * 1024 * 1024; //5MB

const PLUGIN_FILE_NAME = /^[A-Za-z0-9_.-]+\.ts$/;

const bundledPluginSchema = z.object({
  name: z.string().min(1),
  files: z.record(z.string(), z.string()).refine(
    (files) => Object.keys(files).every((n) => PLUGIN_FILE_NAME.test(n)),
    { message: "Bundled plugin file names must be flat '.ts' names." },
  ),
});

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
  bundledPlugins: z.array(bundledPluginSchema),
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
  bundledPlugins: { name: string; files: Record<string, string> }[];
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
      }. This version of HiveAI supports version ${CURRENT_VERSION}.`,
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
