import { join } from "@std/path";
import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { isModelProvider } from "../../../core/ai/providers/types.ts";
import { DEFAULT_CATALOG } from "./default-catalog.ts";
import { type Catalog, type CatalogEntry, isTaskType, type TaskScore } from "../types.ts";

export const CATALOG_FILE_NAME = "model-catalog.json";

export function catalogPath(): string {
  const configDir = HiveMicrokernel.getInstance().getConfig().get("configDir");
  return join(configDir, CATALOG_FILE_NAME);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseTasks(raw: unknown): CatalogEntry["tasks"] {
  const tasks: CatalogEntry["tasks"] = {};
  if (!isObject(raw)) return tasks;
  for (const [key, value] of Object.entries(raw)) {
    if (!isTaskType(key) || !isObject(value)) continue;
    const { score, reason } = value;
    if (typeof score !== "number" || score < 0 || score > 1) continue;
    if (typeof reason !== "string" || !reason.trim()) continue;
    tasks[key] = { score, reason } satisfies TaskScore;
  }
  return tasks;
}

const validPrice = (v: unknown): v is { input: number; output: number } =>
  isObject(v) && typeof v.input === "number" && v.input >= 0 &&
  typeof v.output === "number" && v.output >= 0;

/** Returns null for an entry that is malformed, so one bad line never breaks the catalog. */
export function parseEntry(raw: unknown): CatalogEntry | null {
  if (!isObject(raw)) return null;
  if (typeof raw.provider !== "string" || !isModelProvider(raw.provider)) return null;
  if (typeof raw.match !== "string" || !raw.match) return null;
  const entry: CatalogEntry = {
    provider: raw.provider,
    match: raw.match,
    tasks: parseTasks(raw.tasks),
  };
  if (typeof raw.label === "string") entry.label = raw.label;
  if (isObject(raw.capabilities)) {
    const { vision, tools } = raw.capabilities;
    entry.capabilities = {
      ...(typeof vision === "boolean" ? { vision } : {}),
      ...(typeof tools === "boolean" ? { tools } : {}),
    };
  }
  if (validPrice(raw.price)) entry.price = { input: raw.price.input, output: raw.price.output };
  if (
    isObject(raw.install) && typeof raw.install.ref === "string" &&
    typeof raw.install.sizeBytes === "number" && typeof raw.install.paramsBillions === "number"
  ) {
    entry.install = {
      ref: raw.install.ref,
      sizeBytes: raw.install.sizeBytes,
      paramsBillions: raw.install.paramsBillions,
      ...(typeof raw.install.contextLength === "number" ? { contextLength: raw.install.contextLength } : {}),
    };
  }
  return entry;
}

/**
 * Defaults + user overrides. A user entry with the same provider and `match`
 * replaces the default one; new ones are added. Invalid parts are ignored.
 */
export function mergeCatalog(defaults: Catalog, user: unknown): Catalog {
  if (!isObject(user)) return defaults;
  const entries = [...defaults.entries];
  if (Array.isArray(user.entries)) {
    for (const raw of user.entries) {
      const entry = parseEntry(raw);
      if (!entry) continue;
      const i = entries.findIndex((e) => e.provider === entry.provider && e.match === entry.match);
      if (i >= 0) entries[i] = entry;
      else entries.push(entry);
    }
  }
  const evalMapping = { ...defaults.evalMapping };
  if (isObject(user.evalMapping)) {
    for (const [key, value] of Object.entries(user.evalMapping)) {
      if (isTaskType(key) && Array.isArray(value) && value.every((v) => typeof v === "string")) {
        evalMapping[key] = value;
      }
    }
  }
  const typicalTokens = { ...defaults.typicalTokens };
  if (isObject(user.typicalTokens)) {
    for (const [key, value] of Object.entries(user.typicalTokens)) {
      if (
        isTaskType(key) && isObject(value) && typeof value.input === "number" &&
        typeof value.output === "number"
      ) {
        typicalTokens[key] = { input: value.input, output: value.output };
      }
    }
  }
  return { version: defaults.version, entries, evalMapping, typicalTokens };
}

export interface LoadedCatalog {
  catalog: Catalog;
  path: string;
  /** True when a user file exists and was applied */
  customized: boolean;
}

export async function loadCatalog(path: string = catalogPath()): Promise<LoadedCatalog> {
  try {
    const user = JSON.parse(await Deno.readTextFile(path));
    return { catalog: mergeCatalog(DEFAULT_CATALOG, user), path, customized: true };
  } catch {
    // missing or unreadable/invalid JSON: built-in defaults, never an error
    return { catalog: DEFAULT_CATALOG, path, customized: false };
  }
}

/** Longest-prefix match for a model of the given provider. */
export function findEntry(
  catalog: Catalog,
  provider: string,
  model: string,
): CatalogEntry | undefined {
  return catalog.entries
    .filter((e) => e.provider === provider && model.startsWith(e.match))
    .sort((a, b) => b.match.length - a.match.length)[0];
}
