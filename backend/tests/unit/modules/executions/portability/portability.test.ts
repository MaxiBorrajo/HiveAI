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
import {
  CURRENT_VERSION,
  parseFlowFile,
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

async function exported(install: Awaited<ReturnType<typeof makeInstall>>, id: number) {
  const res = await exportFlow(install.db, install.hive, id, headers);
  return (await res.json()).data;
}

Deno.test("export strips key ids and round-trips into another installation", async () => {
  const a = await makeInstall(true);
  const name = `My flow ${uid()}`;
  const id = await seed(a, name);
  const { file, filename } = await exported(a, id);
  await a.repo.delete(id);

  const text = JSON.stringify(file);
  assertFalse(text.includes("local-key-id"));
  assertFalse(text.includes("secret-key-id"));
  assertEquals(file.formatVersion, CURRENT_VERSION);
  assert(filename.endsWith(".hiveai-flow.json"));

  const b = await makeInstall(true);
  const res = await importFlow(b.db, b.hive, text, {}, headers);
  assertEquals(res.status, 201);
  const data = (await res.json()).data;
  assertFalse(data.isDraft);
  const stored = await b.repo.findById(data.executionId);
  assertEquals(stored?.name, name);
});

Deno.test("rejects corrupt, truncated and non-flow files", () => {
  const text = JSON.stringify({ format: "hiveai-flow", formatVersion: 1 });
  for (const bad of ["{not json", text.slice(0, 10), "[]", '{"a":1}', text]) {
    const r = parseFlowFile(bad);
    assertFalse(r.ok);
  }
});

Deno.test("rejects unsupported format versions with a clear message", () => {
  const r = parseFlowFile({ format: "hiveai-flow", formatVersion: 99 });
  assertFalse(r.ok);
  if (!r.ok) assert(r.error.includes("Unsupported format version 99"));
});

Deno.test("missing plugin imports as a draft and lists what is missing", async () => {
  const a = await makeInstall(true);
  const id = await seed(a, `needs counter ${uid()}`);
  const { file } = await exported(a, id);
  await a.repo.delete(id);

  const b = await makeInstall(false);
  const preview = (await (await previewImport(b.db, b.hive, file, headers)).json()).data;
  assertEquals(preview.missingPlugins, ["counter"]);
  assertEquals(preview.violations, []);

  const res = await importFlow(b.db, b.hive, file, {}, headers);
  const data = (await res.json()).data;
  assert(data.isDraft);
  assertEquals(data.missingPlugins, ["counter"]);
});

Deno.test("name conflict never overwrites without confirmation", async () => {
  const a = await makeInstall(true);
  const dup = `dup ${uid()}`;
  const id = await seed(a, dup);
  const { file } = await exported(a, id);
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

Deno.test("invalid graph is rejected with 422 and creates nothing", async () => {
  const b = await makeInstall(true);
  const file = {
    format: "hiveai-flow",
    formatVersion: 1,
    kind: "execution",
    name: `broken ${uid()}`,
    graph: { nodes: [], edges: [] },
    requiredPlugins: [],
    bundledPlugins: [],
  };
  const before = (await b.repo.findAll()).length;
  const res = await importFlow(b.db, b.hive, file, {}, headers);
  assertEquals(res.status, 422);
  assertEquals((await b.repo.findAll()).length, before);
});

Deno.test("bundled plugin with path traversal is rejected by the format", () => {
  const r = parseFlowFile({
    format: "hiveai-flow",
    formatVersion: 1,
    kind: "execution",
    name: "x",
    graph: { nodes: [], edges: [] },
    requiredPlugins: [],
    bundledPlugins: [{ name: "p", files: { "../evil.ts": "x" } }],
  });
  assertFalse(r.ok);
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
