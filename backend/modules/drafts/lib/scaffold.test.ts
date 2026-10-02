import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { scaffoldDraftPlugin } from "./scaffold.ts";

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("scaffoldDraftPlugin - creates the draft directory under draftsDir/pluginName", async () => {
  const tempDir = await Deno.makeTempDir();
  const { dir } = await scaffoldDraftPlugin(tempDir, "my-plugin");
  assertEquals(dir, join(tempDir, "my-plugin"));
  assertEquals(await fileExists(dir), true);
});

Deno.test("scaffoldDraftPlugin - writes both index.ts and bee-plugin.ts", async () => {
  const tempDir = await Deno.makeTempDir();
  const { dir } = await scaffoldDraftPlugin(tempDir, "my-plugin");
  assertEquals(await fileExists(join(dir, "index.ts")), true);
  assertEquals(await fileExists(join(dir, "bee-plugin.ts")), true);
});

Deno.test("scaffoldDraftPlugin - the scaffolded bee-plugin.ts is byte-identical to the microkernel's core version", async () => {
  const tempDir = await Deno.makeTempDir();
  const { dir } = await scaffoldDraftPlugin(tempDir, "my-plugin");

  const coreBeePlugin = await readFile(
    new URL("../../../core/microkernel/bee-plugin.ts", import.meta.url),
    "utf-8",
  );
  const scaffoldedBeePlugin = await readFile(join(dir, "bee-plugin.ts"), "utf-8");
  assertEquals(scaffoldedBeePlugin, coreBeePlugin);
});

Deno.test("scaffoldDraftPlugin - index.ts embeds the given plugin name as the `name` field", async () => {
  const tempDir = await Deno.makeTempDir();
  const { dir } = await scaffoldDraftPlugin(tempDir, "web-scraper");
  const indexTs = await readFile(join(dir, "index.ts"), "utf-8");
  assertEquals(indexTs.includes('name = "web-scraper";'), true);
});

Deno.test("scaffoldDraftPlugin - converts a hyphenated plugin name into a PascalCase class name", async () => {
  const tempDir = await Deno.makeTempDir();
  const { dir } = await scaffoldDraftPlugin(tempDir, "web-scraper-tool");
  const indexTs = await readFile(join(dir, "index.ts"), "utf-8");
  assertEquals(indexTs.includes("export default class WebScraperTool"), true);
});

Deno.test("scaffoldDraftPlugin - converts an underscore/space-separated plugin name into PascalCase", async () => {
  const tempDir = await Deno.makeTempDir();
  const { dir } = await scaffoldDraftPlugin(tempDir, "file read_helper");
  const indexTs = await readFile(join(dir, "index.ts"), "utf-8");
  assertEquals(indexTs.includes("export default class FileReadHelper"), true);
});

Deno.test("scaffoldDraftPlugin - falls back to 'MyPlugin' as the class name when the name yields no valid parts", async () => {
  const tempDir = await Deno.makeTempDir();
  const { dir } = await scaffoldDraftPlugin(tempDir, "---");
  const indexTs = await readFile(join(dir, "index.ts"), "utf-8");
  assertEquals(indexTs.includes("export default class MyPlugin"), true);
});

Deno.test("scaffoldDraftPlugin - the generated index.ts imports BeeContext/BeePlugin from the scaffolded bee-plugin.ts", async () => {
  const tempDir = await Deno.makeTempDir();
  const { dir } = await scaffoldDraftPlugin(tempDir, "my-plugin");
  const indexTs = await readFile(join(dir, "index.ts"), "utf-8");
  assertEquals(indexTs.includes('from "./bee-plugin.ts"'), true);
});

Deno.test("scaffoldDraftPlugin - re-scaffolding the same plugin name overwrites the existing files without throwing", async () => {
  const tempDir = await Deno.makeTempDir();
  await scaffoldDraftPlugin(tempDir, "my-plugin");
  const { dir } = await scaffoldDraftPlugin(tempDir, "my-plugin");
  assertEquals(await fileExists(join(dir, "index.ts")), true);
});
