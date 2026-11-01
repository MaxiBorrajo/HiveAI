import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BlobWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip-js/zip-js";

/** The interface file is never exported: importers always use their own. */
export const EXCLUDED_FROM_EXPORT = "bee-plugin.ts";

export const MAX_ZIP_ENTRIES = 200;

/** Lists the `.ts` files of a plugin folder that belong in an export. */
export async function listExportablePluginFiles(
  dir: string,
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter(
      (e) =>
        e.isFile() && e.name.endsWith(".ts") && e.name !== EXCLUDED_FROM_EXPORT,
    )
    .map((e) => e.name);
}

export async function zipTsFolder(
  dir: string,
  folderName: string,
): Promise<Blob> {
  const files = await listExportablePluginFiles(dir);

  const zipBlobWriter = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(zipBlobWriter);

  for (const file of files) {
    const content = await readFile(join(dir, file));
    await zipWriter.add(
      `${folderName}/${file}`,
      new Blob([new Uint8Array(content)]).stream(),
    );
  }

  await zipWriter.close();
  return zipBlobWriter.getData();
}

export class ZipReadError extends Error {}

function normalizeEntryPath(raw: string): string {
  const path = raw.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new ZipReadError(`Unsafe path in the zip: "${raw}".`);
  }
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) {
    throw new ZipReadError(`Unsafe path in the zip: "${raw}".`);
  }
  return segments.join("/");
}

/**
 * Reads every file of a zip into memory, refusing unsafe paths and archives
 * that would expand beyond `maxTotalBytes` (checked before inflating).
 */
export async function readZip(
  bytes: Uint8Array,
  maxTotalBytes: number,
): Promise<Map<string, Uint8Array>> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    let entries;
    try {
      entries = (await reader.getEntries()).filter((e) => !e.directory);
    } catch {
      throw new ZipReadError("The file is not a valid zip archive.");
    }
    if (entries.length > MAX_ZIP_ENTRIES) {
      throw new ZipReadError("The zip contains too many files.");
    }
    const declared = entries.reduce((n, e) => n + e.uncompressedSize, 0);
    if (declared > maxTotalBytes) {
      throw new ZipReadError(
        `The zip is too large once extracted (limit ${
          Math.round(maxTotalBytes / 1024 / 1024)
        }MB).`,
      );
    }

    const files = new Map<string, Uint8Array>();
    for (const entry of entries) {
      const path = normalizeEntryPath(entry.filename);
      if (!path || path.startsWith("__MACOSX/")) continue;
      files.set(path, await entry.getData!(new Uint8ArrayWriter()));
    }
    return files;
  } finally {
    await reader.close();
  }
}

/**
 * Picks the plugin files out of zip entries under `prefix` ("" for the zip
 * root). Returns flat `.ts` files, never including `bee-plugin.ts`.
 */
export function pluginFilesFromEntries(
  entries: Map<string, Uint8Array>,
  prefix = "",
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const [path, content] of entries) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest.includes("/") || !rest.endsWith(".ts")) continue;
    if (rest === EXCLUDED_FROM_EXPORT) continue;
    files[rest] = content;
  }
  return files;
}

/**
 * A plugin zip holds `index.ts` either at the root or inside a single folder
 * (the layout produced by `zipTsFolder`).
 */
export function pluginFilesFromPluginZip(
  entries: Map<string, Uint8Array>,
): Record<string, Uint8Array> {
  if (entries.has("index.ts")) return pluginFilesFromEntries(entries);

  const roots = new Set(
    [...entries.keys()].filter((p) => p.includes("/")).map((p) => p.split("/")[0]),
  );
  if (roots.size === 1) {
    const [root] = roots;
    if (entries.has(`${root}/index.ts`)) {
      return pluginFilesFromEntries(entries, `${root}/`);
    }
  }
  throw new ZipReadError(
    "The zip does not contain a plugin: expected an index.ts at its root or inside a single folder.",
  );
}

export async function writePluginFiles(
  dir: string,
  files: Record<string, Uint8Array | string>,
): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const dest = join(dir, name);
    if (typeof content === "string") await Deno.writeTextFile(dest, content);
    else await Deno.writeFile(dest, content);
  }
}
