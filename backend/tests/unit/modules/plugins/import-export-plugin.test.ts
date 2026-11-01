import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "node:path";
import { BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter } from "@zip-js/zip-js";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { handleImportPlugin } from "../../../../modules/plugins/use-cases/import-plugin.ts";
import { zipTsFolder } from "../../../../core/files/zip-folder.ts";

const headers = { "content-type": "application/json" };
const COUNTER_DIR = new URL("../../../../plugins/counter/", import.meta.url);

async function zipOf(files: Record<string, string>): Promise<File> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, content] of Object.entries(files)) {
    await writer.add(path, new Blob([content]).stream());
  }
  return new File([await writer.close()], "plugin.zip", { type: "application/zip" });
}

function uploadRequest(file: File): Request {
  const form = new FormData();
  form.append("file", file, file.name);
  return new Request("http://localhost/api/plugins/import", { method: "POST", body: form });
}

async function makeHive() {
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: await Deno.makeTempDir() });
  return hive;
}

Deno.test("importing a plugin zip installs it with the local interface file", async () => {
  const hive = await makeHive();
  const source = await Deno.readTextFile(new URL("index.ts", COUNTER_DIR));
  const zip = await zipOf({
    "counter/index.ts": source,
    "counter/bee-plugin.ts": "// stale, must be ignored",
  });

  const res = await handleImportPlugin(hive, uploadRequest(zip), headers);
  assertEquals(res.status, 200);
  try {
    const dir = await hive.getExternalPluginDir("counter");
    assert(dir);
    assertFalse((await Deno.readTextFile(join(dir, "bee-plugin.ts"))).includes("stale"));
  } finally {
    await hive.removeExternalPlugin("counter");
  }
});

Deno.test("exporting a plugin never includes bee-plugin.ts", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.copyFile(new URL("index.ts", COUNTER_DIR), join(dir, "index.ts"));
  await Deno.copyFile(new URL("bee-plugin.ts", COUNTER_DIR), join(dir, "bee-plugin.ts"));
  const bytes = new Uint8Array(await (await zipTsFolder(dir, "counter")).arrayBuffer());
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const names = (await reader.getEntries()).map((e) => e.filename);
  await reader.close();
  assertEquals(names, ["counter/index.ts"]);
});

Deno.test("a plugin zip that breaks the interface fails with 422 and nothing is installed", async () => {
  const hive = await makeHive();
  const broken = (await Deno.readTextFile(new URL("index.ts", COUNTER_DIR))).replace(
    /async process\([^)]*\)[^{]*\{/,
    "process(): number {\n    return 1;\n  }\n  async other() {",
  );
  const res = await handleImportPlugin(
    hive,
    uploadRequest(await zipOf({ "index.ts": broken })),
    headers,
  );
  assertEquals(res.status, 422);
  const body = await res.json();
  assert(body.errors[0].includes("BeePlugin interface"));
  assertEquals(await hive.getExternalPluginDir("counter"), undefined);
});

Deno.test("non-zip uploads and missing files are rejected", async () => {
  const hive = await makeHive();
  const bad = new File(["nope"], "x.zip");
  assertEquals((await handleImportPlugin(hive, uploadRequest(bad), headers)).status, 400);
  const empty = new Request("http://localhost/x", { method: "POST", body: new FormData() });
  assertEquals((await handleImportPlugin(hive, empty, headers)).status, 400);
});
