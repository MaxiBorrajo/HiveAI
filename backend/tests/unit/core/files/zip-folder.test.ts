import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "node:path";
import { BlobWriter, ZipWriter } from "@zip-js/zip-js";
import {
  pluginFilesFromPluginZip,
  readZip,
  zipTsFolder,
  ZipReadError,
} from "../../../../core/files/zip-folder.ts";

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, content] of Object.entries(files)) {
    await writer.add(path, new Blob([content]).stream());
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

Deno.test("zipTsFolder skips bee-plugin.ts and round-trips through readZip", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(dir, "index.ts"), "export default 1;");
    await Deno.writeTextFile(join(dir, "helper.ts"), "export const a = 1;");
    await Deno.writeTextFile(join(dir, "bee-plugin.ts"), "// interface");
    const bytes = new Uint8Array(await (await zipTsFolder(dir, "my_plugin")).arrayBuffer());
    const entries = await readZip(bytes, 1024 * 1024);
    assertEquals([...entries.keys()].sort(), ["my_plugin/helper.ts", "my_plugin/index.ts"]);
    assertEquals(Object.keys(pluginFilesFromPluginZip(entries)).sort(), ["helper.ts", "index.ts"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("plugin zip accepts index.ts at the root and drops bee-plugin.ts", async () => {
  const entries = await readZip(
    await zipOf({ "index.ts": "x", "bee-plugin.ts": "y" }),
    1024,
  );
  assertEquals(Object.keys(pluginFilesFromPluginZip(entries)), ["index.ts"]);
});

Deno.test("zip without a plugin index.ts is rejected", async () => {
  const entries = await readZip(await zipOf({ "a/readme.ts": "x", "b/index.ts": "y" }), 1024);
  try {
    pluginFilesFromPluginZip(entries);
    throw new Error("should have thrown");
  } catch (error) {
    assert(error instanceof ZipReadError);
  }
});

Deno.test("readZip rejects traversal, oversized and non-zip input", async () => {
  await assertRejects(() => readZip(new TextEncoder().encode("nope"), 1024), ZipReadError);
  await assertRejects(
    () => readZip(new Uint8Array(0), 1024),
    ZipReadError,
  );
  await assertRejects(
    async () => readZip(await zipOf({ "../evil.ts": "x" }), 1024),
    ZipReadError,
  );
  await assertRejects(
    async () => readZip(await zipOf({ "big.ts": "x".repeat(5000) }), 1024),
    ZipReadError,
    "too large",
  );
});
