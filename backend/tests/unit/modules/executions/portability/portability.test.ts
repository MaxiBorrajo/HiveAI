import { assert, assertEquals, assertFalse } from "@std/assert";
import { HiveMicrokernel } from "../../../../../core/microkernel/hive-microkernel.ts";
import { initORM } from "../../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../../infrastructure/db/repositories/execution-repository.ts";
import CounterPlugin from "../../../../../plugins/counter/index.ts";
import type { LangGraphAbstraction } from "../../../../../core/ai/visual-builder/types.ts";
import { exportFlow } from "../../../../../modules/executions/portability/export-flow.ts";
import {
  importFlow,
  previewImport,
} from "../../../../../modules/executions/portability/import-flow.ts";
import { BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter } from "@zip-js/zip-js";
import {
  CURRENT_VERSION,
  parseFlowFile,
  readFlowZip,
} from "../../../../../modules/executions/portability/flow-format.ts";
import { scanGraphForSecrets } from "../../../../../modules/executions/portability/scan-secrets.ts";

const headers = { "content-type": "application/json" };

// initORM is a process-wide singleton, so "installations" share one database:
// every test uses a unique name and removes the source execution before
// importing, to emulate importing on another machine.
const uid = () => crypto.randomUUID().slice(0, 8);

async function makeInstall(withPlugin: boolean) {
  const dir = await Deno.makeTempDir();
  const db = await initORM(dir);
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: dir });
  if (withPlugin) await hive.register(new CounterPlugin());
  return { db, hive, repo: new ExecutionRepository(db) };
}

function graph(pluginId = "counter"): LangGraphAbstraction {
  return {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      {
        id: "step",
        name: "Step",
        type: "plugin",
        config: {
          pluginId,
          outputKey: "result_value",
          inputMapping: {},
          keyId: "local-key-id",
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        config: { output: { type: "text", contentKey: "result_value" } },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "step", isConditional: false },
      { id: "e2", source: "step", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
}

async function seed(
  install: Awaited<ReturnType<typeof makeInstall>>,
  name: string,
  g = graph(),
) {
  const now = Date.now();
  const e = await install.repo.create({ name, createdAt: now, updatedAt: now });
  const saved = await install.repo.createGraph({
    executionId: e.id,
    graph: g,
    state: g.stateSchema,
    orchestrator: { provider: "ollama", model: "m", keyId: "secret-key-id" },
    createdAt: now,
  });
  await install.repo.update(e.id, { lastGraphId: saved.id });
  return e.id;
}

async function zipOf(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, content] of Object.entries(files)) {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    await writer.add(path, new Blob([bytes as Uint8Array<ArrayBuffer>]).stream());
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

async function listZip(bytes: Uint8Array): Promise<string[]> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const names = (await reader.getEntries()).map((e) => e.filename);
  await reader.close();
  return names;
}

/** Exports without touching the real Downloads folder. */
async function exported(install: Awaited<ReturnType<typeof makeInstall>>, id: number) {
  let saved: { filename: string; bytes: Uint8Array } | undefined;
  const res = await exportFlow(install.db, install.hive, id, headers, {
    confirmSecrets: true,
    save: (filename, bytes) => {
      saved = { filename, bytes };
      return Promise.resolve(`/fake/${filename}`);
    },
  });
  assertEquals(res.status, 200);
  assert(saved);
  return saved;
}

Deno.test("export is a zip with flow.json, strips key ids and round-trips", async () => {
  const a = await makeInstall(true);
  const name = `My flow ${uid()}`;
  const id = await seed(a, name);
  const { bytes, filename } = await exported(a, id);
  await a.repo.delete(id);

  assert(filename.endsWith(".hiveai-flow.zip"));
  assertEquals(await listZip(bytes), ["flow.json"]);
  const read = await readFlowZip(bytes);
  assert(read.ok);
  const text = JSON.stringify(read.parsed.file);
  assertFalse(text.includes("local-key-id"));
  assertFalse(text.includes("secret-key-id"));
  assertEquals(read.parsed.file.formatVersion, CURRENT_VERSION);

  const b = await makeInstall(true);
  const res = await importFlow(b.db, b.hive, bytes, {}, headers);
  assertEquals(res.status, 201);
  const data = (await res.json()).data;
  assertFalse(data.isDraft);
  const stored = await b.repo.findById(data.executionId);
  assertEquals(stored?.name, name);
});

Deno.test("export asks for confirmation before saving when secrets are found", async () => {
  const a = await makeInstall(true);
  const g = graph();
  g.nodes[1].config.inputMapping = { token: "Bearer abcdefghijklmnop1234" };
  const id = await seed(a, `secret ${uid()}`, g);
  let saves = 0;
  const save = () => {
    saves++;
    return Promise.resolve("/fake");
  };
  const first = await (await exportFlow(a.db, a.hive, id, headers, { save })).json();
  assertFalse(first.data.saved);
  assertEquals(first.data.secretWarnings.length, 1);
  assertEquals(saves, 0);
  await exportFlow(a.db, a.hive, id, headers, { save, confirmSecrets: true });
  assertEquals(saves, 1);
});

Deno.test("rejects corrupt, truncated and non-flow files", async () => {
  const text = JSON.stringify({ format: "hiveai-flow", formatVersion: CURRENT_VERSION });
  for (const bad of ["{not json", text.slice(0, 10), "[]", '{"a":1}', text]) {
    assertFalse(parseFlowFile(bad).ok);
  }
  assertFalse((await readFlowZip(new TextEncoder().encode("not a zip"))).ok);
  assertFalse((await readFlowZip(await zipOf({ "other.json": "{}" }))).ok);
});

Deno.test("rejects unsupported format versions with a clear message", () => {
  const r = parseFlowFile({ format: "hiveai-flow", formatVersion: 99 });
  assertFalse(r.ok);
  if (!r.ok) assert(r.error.includes("Unsupported format version 99"));
  assertFalse(parseFlowFile({ format: "hiveai-flow", formatVersion: 1 }).ok);
});

Deno.test("missing plugin imports as a draft and lists what is missing", async () => {
  const a = await makeInstall(true);
  const id = await seed(a, `needs counter ${uid()}`);
  const { bytes } = await exported(a, id);
  await a.repo.delete(id);

  const b = await makeInstall(false);
  const preview = (await (await previewImport(b.db, b.hive, bytes, headers)).json()).data;
  assertEquals(preview.missingPlugins, ["counter"]);
  assertEquals(preview.violations, []);

  const res = await importFlow(b.db, b.hive, bytes, {}, headers);
  const data = (await res.json()).data;
  assert(data.isDraft);
  assertEquals(data.missingPlugins, ["counter"]);
});

Deno.test("name conflict never overwrites without confirmation", async () => {
  const a = await makeInstall(true);
  const dup = `dup ${uid()}`;
  const id = await seed(a, dup);
  const { bytes: file } = await exported(a, id);
  const before = await a.repo.findAll();

  const refused = await importFlow(a.db, a.hive, file, {}, headers);
  assertEquals(refused.status, 409);
  assertEquals((await a.repo.findAll()).length, before.length);

  const copy = await importFlow(a.db, a.hive, file, { conflict: "new" }, headers);
  assertEquals(copy.status, 201);
  const names = (await a.repo.findAll()).map((e) => e.name);
  assert(names.includes(dup));
  assert(names.includes(`${dup} (imported)`));
});

const flowJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: "hiveai-flow",
    formatVersion: CURRENT_VERSION,
    kind: "execution",
    name: `x ${uid()}`,
    graph: { nodes: [], edges: [] },
    requiredPlugins: [],
    ...extra,
  });

Deno.test("invalid graph is rejected with 422 and creates nothing", async () => {
  const b = await makeInstall(true);
  const bytes = await zipOf({ "flow.json": flowJson() });
  const before = (await b.repo.findAll()).length;
  const res = await importFlow(b.db, b.hive, bytes, {}, headers);
  assertEquals(res.status, 422);
  assertEquals((await b.repo.findAll()).length, before);
});

Deno.test("flow zip never exposes bee-plugin.ts and ignores one if present", async () => {
  const bytes = await zipOf({
    "flow.json": flowJson(),
    "plugins/p/index.ts": "export default class P {}",
    "plugins/p/bee-plugin.ts": "// should be ignored",
  });
  const read = await readFlowZip(bytes);
  assert(read.ok);
  assertEquals(Object.keys(read.parsed.bundledPlugins[0].files), ["index.ts"]);
});

Deno.test("flow zip with an unsafe plugin path is rejected", async () => {
  const bytes = await zipOf({
    "flow.json": flowJson(),
    "plugins/../../evil.ts": "x",
  });
  assertFalse((await readFlowZip(bytes)).ok);
});

Deno.test("scanGraphForSecrets flags secret-looking text without echoing it", () => {
  const g = graph();
  g.nodes[1].config.inputMapping = { token: "Bearer abcdefghijklmnop1234" };
  const warnings = scanGraphForSecrets(g);
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].nodeId, "step");
  assertFalse(JSON.stringify(warnings).includes("abcdefghijklmnop"));
  assertEquals(scanGraphForSecrets(graph()), []);
});

const COUNTER_SOURCE = new URL("../../../../../plugins/counter/index.ts", import.meta.url);

async function flowWithBundledCounter(source: string) {
  const a = await makeInstall(true);
  const id = await seed(a, `bundled ${uid()}`);
  const { bytes } = await exported(a, id);
  await a.repo.delete(id);
  const read = await readFlowZip(bytes);
  assert(read.ok);
  return await zipOf({
    "flow.json": JSON.stringify(read.parsed.file),
    "plugins/counter/index.ts": source,
    "plugins/counter/bee-plugin.ts": "// stale interface that must be ignored",
  });
}

Deno.test("bundled plugin is installed against the local BeePlugin interface", async () => {
  const bytes = await flowWithBundledCounter(await Deno.readTextFile(COUNTER_SOURCE));
  const b = await makeInstall(false);
  try {
    const preview = (await (await previewImport(b.db, b.hive, bytes, headers)).json()).data;
    assertEquals(preview.bundledPlugins[0].status, "missing");
    assertEquals(preview.bundledPlugins[0].conformanceIssues, []);
    assertFalse("bee-plugin.ts" in preview.bundledPlugins[0].files);

    const res = await importFlow(b.db, b.hive, bytes, { installBundledPlugins: ["counter"] }, headers);
    const data = (await res.json()).data;
    assertEquals(data.plugins, [{ name: "counter", installed: true }]);
    assertFalse(data.isDraft);

    const dir = await b.hive.getExternalPluginDir("counter");
    assert(dir);
    const installed = await Deno.readTextFile(`${dir}/bee-plugin.ts`);
    const local = await Deno.readTextFile(
      new URL("../../../../../core/microkernel/bee-plugin.ts", import.meta.url),
    );
    assertEquals(installed, local);
  } finally {
    await b.hive.removeExternalPlugin("counter");
  }
});

Deno.test("bundled plugin that does not match the interface is reported and not installed", async () => {
  const broken = (await Deno.readTextFile(COUNTER_SOURCE)).replace(
    /async process\([^)]*\)[^{]*\{/,
    "process(): number {\n    return 1;\n  }\n  async other() {",
  );
  const bytes = await flowWithBundledCounter(broken);
  const b = await makeInstall(false);
  const preview = (await (await previewImport(b.db, b.hive, bytes, headers)).json()).data;
  assert(preview.bundledPlugins[0].conformanceIssues.length > 0);

  const res = await importFlow(b.db, b.hive, bytes, { installBundledPlugins: ["counter"] }, headers);
  const data = (await res.json()).data;
  assertFalse(data.plugins[0].installed);
  assert(data.plugins[0].error.includes("BeePlugin interface"));
  assert(data.isDraft);
});
