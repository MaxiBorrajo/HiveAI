import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import {
  buildPluginTool,
  sanitizeHistory,
} from "../../../modules/plugin-test-chat/test-chat.ts";
import { handleGetPluginFiles } from "../../../modules/plugins/use-cases/get-plugin-files.ts";
import { handleImportPlugin } from "../../../modules/plugins/use-cases/import-plugin.ts";
import { BlobWriter, ZipWriter } from "@zip-js/zip-js";

const COUNTER = new URL("../../../plugins/counter/index.ts", import.meta.url);
const headers = { "content-type": "application/json" };

async function pluginDir(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "test-chat-" });
  await Deno.copyFile(COUNTER, join(dir, "index.ts"));
  return dir;
}

Deno.test("sanitizeHistory keeps only well-formed turns and caps the length", () => {
  assertEquals(sanitizeHistory("nope"), []);
  const cleaned = sanitizeHistory([
    { role: "user", content: "hi" },
    { role: "system", content: "ignored" },
    { role: "assistant", content: "" },
    { role: "assistant", content: "hello" },
    null,
  ]);
  assertEquals(cleaned, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
  const many = Array.from({ length: 100 }, (_, i) => ({ role: "user", content: String(i) }));
  assertEquals(sanitizeHistory(many).length, 40);
});

Deno.test("the plugin is exposed as a tool with its real input schema and really runs", async () => {
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: await Deno.makeTempDir() });
  const handle = await hive.probeExternalPlugin(await pluginDir());
  try {
    const props = (handle.jsonSchema as { properties?: Record<string, unknown> }).properties;
    assert(props && "action" in props && "name" in props, "schema should list the real params");

    const tool = buildPluginTool(handle);
    assertEquals(tool.name, "counter");
    const out = await tool.invoke({ name: "visits", action: "increment", amount: 2 });
    assertStringIncludes(String(out), "2");
  } finally {
    await handle.stop();
  }
});

Deno.test("installed plugin sources are readable, others are 404", async () => {
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: await Deno.makeTempDir() });

  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("counter/index.ts", new Blob([await Deno.readTextFile(COUNTER)]).stream());
  const zip = new File([await writer.close()], "counter.zip");
  const form = new FormData();
  form.append("file", zip, "counter.zip");
  const imported = await handleImportPlugin(
    hive,
    new Request("http://localhost/x", { method: "POST", body: form }),
    headers,
  );
  assertEquals(imported.status, 200);

  try {
    const res = await handleGetPluginFiles(hive, "counter", headers);
    assertEquals(res.status, 200);
    const names = (await res.json()).data.files.map((f: { name: string }) => f.name).sort();
    assertEquals(names, ["bee-plugin.ts", "index.ts"]);

    assertEquals((await handleGetPluginFiles(hive, "nope", headers)).status, 404);
  } finally {
    await hive.removeExternalPlugin("counter");
  }
});
