import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PluginSourceFile {
  name: string;
  content: string;
}

/** The flat `.ts` files of a plugin folder, as shown in the plugin editor. */
export async function readPluginSourceFiles(
  dir: string,
): Promise<PluginSourceFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map(async (e) => ({
        name: e.name,
        content: await readFile(join(dir, e.name), "utf-8"),
      })),
  );
}
