import { basename, extname, join } from "node:path";
import { homeDir } from "../env.ts";

function sanitizeFilename(filename: string): string {
  const base = basename(filename.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .trim();
  return base && base !== "." && base !== ".." ? base : "download";
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function saveToDownloads(
  filename: string,
  data: string | Uint8Array,
): Promise<string> {
  const downloadsDir = join(homeDir!, "Downloads");
  await Deno.mkdir(downloadsDir, { recursive: true });

  const safe = sanitizeFilename(filename);
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);

  let filePath = join(downloadsDir, safe);
  for (let i = 1; await exists(filePath); i++) {
    filePath = join(downloadsDir, `${stem} (${i})${ext}`);
  }

  if (typeof data === "string") await Deno.writeTextFile(filePath, data);
  else await Deno.writeFile(filePath, data);
  return filePath;
}
