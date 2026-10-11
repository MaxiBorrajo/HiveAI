import { assertEquals, assertExists } from "@std/assert";
import { initORM } from "../../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../../infrastructure/db/repositories/execution-repository.ts";
import { ApiKeyRepository } from "../../../../../infrastructure/db/repositories/api-key-repository.ts";
import { ModelUsageRepository } from "../../../../../infrastructure/db/repositories/model-usage-repository.ts";
import { HiveMicrokernel } from "../../../../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../../../../plugins/counter/index.ts";
import { runExecution } from "../../../../../modules/executions/use-cases/run-execution/run-execution.ts";
import { listRuns } from "../../../../../modules/executions/use-cases/list-runs.ts";
import { updateExecutionGraph } from "../../../../../modules/executions/use-cases/update-execution-graph.ts";
import type { LangGraphAbstraction } from "../../../../../core/ai/visual-builder/types.ts";

async function setup() {
  const db = await initORM(await Deno.makeTempDir());
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: await Deno.makeTempDir() });
  await hive.register(new CounterPlugin());
  await hive.activate("counter");
  return {
    db,
    hive,
    executions: new ExecutionRepository(db),
    keys: new ApiKeyRepository(db),
    usage: new ModelUsageRepository(db),
  };
}

function counterGraph(): LangGraphAbstraction {
  return {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      {
        id: "count_step",
        name: "Count Step",
        type: "plugin",
        config: {
          pluginId: "counter",
          inputMapping: { name: "counter_name", action: "action" },
          outputKey: "count_result",
        },
      },
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "count_step", isConditional: false },
      { id: "e2", source: "count_step", target: "end", isConditional: false },
    ],
    stateSchema: {
      counter_name: { type: "string", required: true },
      action: { type: "string", required: true },
      count_result: { type: "string", required: false },
    },
  };
}

async function runOnce(
  s: Awaited<ReturnType<typeof setup>>,
  executionId: number,
  counter: string,
) {
  const res = await runExecution(
    s.db,
    s.hive,
    executionId,
    { counter_name: counter, action: "get" },
    {},
  );
  const text = await res.text();
  const data = text.split("\n").find((l) => l.startsWith("data: ") && l.includes("historyId"));
  return JSON.parse(data!.replace("data: ", "")) as { historyId: number };
}

Deno.test("a run keeps the orchestrator the graph was generated with, with the key alias as it was", async () => {
  const s = await setup();
  const key = await s.keys.create({
    id: crypto.randomUUID(),
    provider: "anthropic",
    alias: "work",
    last4: "abcd",
    createdAt: 1,
    updatedAt: 1,
  });
  const execution = await s.executions.create({
    name: "run-info",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const graph = await s.executions.createGraph({
    executionId: execution.id,
    graph: counterGraph(),
    state: counterGraph().stateSchema,
    orchestrator: { provider: "anthropic", model: "claude-x", keyId: key.id },
    createdAt: Date.now(),
  });
  await s.executions.update(execution.id, { lastGraphId: graph.id });

  const { historyId } = await runOnce(s, execution.id, "run-info-counter");

  // The key is renamed and deleted afterwards: the run does not change.
  await s.keys.update(key.id, { alias: "renamed" });
  await s.keys.delete(key.id);

  const history = await s.executions.findHistoryById(historyId);
  const stored = JSON.parse(history!.result as string);
  assertExists(stored.run);
  assertEquals(stored.run.orchestrator.model, "claude-x");
  assertEquals(stored.run.orchestrator.source, "generation");
  assertEquals(stored.run.orchestrator.keyAlias, "work");
  assertEquals(stored.run.durationMs, stored.run.endedAt - stored.run.startedAt);
  assertEquals(
    stored.run.nodes.map((n: { id: string }) => n.id),
    ["start", "count_step", "end"],
  );
});

Deno.test("listRuns - each run carries its own usage; runs before the feature have none", async () => {
  const s = await setup();
  const execution = await s.executions.create({
    name: "runs-list",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const graph = await s.executions.createGraph({
    executionId: execution.id,
    graph: counterGraph(),
    state: counterGraph().stateSchema,
    createdAt: Date.now(),
  });
  await s.executions.update(execution.id, { lastGraphId: graph.id });

  // A run saved the way it was before this feature: no `run`, no usage rows.
  const old = await s.executions.createHistory({
    executionId: execution.id,
    iteration: 1,
    result: JSON.stringify({ result: { type: "text", content: "old" }, finalState: {} }),
    version: graph.id,
    createdAt: 1_000,
  });

  // A new run, with a local call and a cloud call linked to it.
  const { historyId } = await runOnce(s, execution.id, "runs-list-counter");
  const group = crypto.randomUUID();
  const base = {
    groupId: group,
    contextKind: "execution" as const,
    status: "ok" as const,
    errorType: null,
    durationMs: 1_000,
    ttftMs: 100,
    createdAt: Date.now(),
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
  };
  await s.usage.record({
    usage: {
      ...base,
      provider: "ollama",
      model: "llama3",
      location: "local",
      role: "delegate",
      keyId: null,
      keyAlias: null,
      inputTokens: 300,
      outputTokens: 30,
    },
    link: { kind: "execution", executionId: execution.id, nodeId: "count_step" },
  });
  await s.usage.record({
    usage: {
      ...base,
      provider: "anthropic",
      model: "claude-x",
      location: "cloud",
      role: "orchestrator",
      keyId: "k1",
      keyAlias: "work",
      inputTokens: 900,
      outputTokens: 90,
    },
    link: { kind: "execution", executionId: execution.id, nodeId: "count_step" },
  });
  await s.usage.attachHistory(group, historyId);

  const response = await listRuns(s.db, execution.id, {});
  const { data } = await response.json();
  const runs = data.runs as {
    historyId: number;
    iteration: number;
    input: Record<string, unknown> | null;
    usage: any;
  }[];

  // Newest first.
  assertEquals(runs.map((r) => r.iteration), [2, 1]);

  const [fresh, previous] = runs;
  assertEquals(fresh.historyId, historyId);
  assertEquals(fresh.usage.calls, 2);
  assertEquals(fresh.usage.local.inputTokens, 300);
  assertEquals(fresh.usage.cloud.inputTokens, 900);
  assertEquals(fresh.usage.cloud.models[0].keyAliases, ["work"]);
  assertEquals(typeof fresh.usage.latencyMs, "number");

  // The input the run was started with is kept; older runs have none.
  assertEquals(fresh.input, { counter_name: "runs-list-counter", action: "get" });
  assertEquals(previous.input, null);

  assertEquals(previous.historyId, old.id);
  assertEquals(previous.usage, null);
});

Deno.test("listRuns - an unknown execution is a 404", async () => {
  const s = await setup();
  const response = await listRuns(s.db, 999_999, {});
  assertEquals(response.status, 404);
});

Deno.test("editing a graph by hand keeps the model that orchestrated it", async () => {
  const s = await setup();
  const execution = await s.executions.create({
    name: "keep-orchestrator",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const first = await s.executions.createGraph({
    executionId: execution.id,
    graph: counterGraph(),
    state: counterGraph().stateSchema,
    orchestrator: { provider: "anthropic", model: "claude-x", keyId: "k1" },
    createdAt: Date.now(),
  });
  await s.executions.update(execution.id, { lastGraphId: first.id });

  // A graph the validator accepts: the end node declares its output type.
  const edited = counterGraph();
  edited.nodes[2].config = { output: { type: "text", contentKey: "count_result" } };

  const response = await updateExecutionGraph(
    s.db,
    s.hive,
    execution.id,
    edited,
    undefined,
    {},
  );
  const body = await response.json();
  assertEquals(body.success, true, JSON.stringify(body));
  const saved = await s.executions.findGraphById(body.data.graphId);

  assertEquals(saved?.orchestrator, {
    provider: "anthropic",
    model: "claude-x",
    keyId: "k1",
  });
});

Deno.test("listRuns - what generating the graph cost counts as the orchestrator's share of each later run", async () => {
  const s = await setup();
  const execution = await s.executions.create({
    name: "design-share",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const graph = await s.executions.createGraph({
    executionId: execution.id,
    graph: counterGraph(),
    state: counterGraph().stateSchema,
    createdAt: Date.now(),
  });
  await s.executions.update(execution.id, { lastGraphId: graph.id });

  // The orchestrator designed the graph, before the run.
  await s.usage.record({
    usage: {
      groupId: crypto.randomUUID(),
      contextKind: "graph_generation",
      provider: "anthropic",
      model: "claude-x",
      location: "cloud",
      role: "orchestrator",
      keyId: "k1",
      keyAlias: "work",
      inputTokens: 600,
      outputTokens: 400,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      durationMs: 1_000,
      ttftMs: 100,
      status: "ok",
      errorType: null,
      createdAt: Date.now() - 60_000,
    },
    link: { kind: "graph_generation", executionId: execution.id },
  });

  const { historyId } = await runOnce(s, execution.id, "design-share-counter");
  const group = crypto.randomUUID();
  await s.usage.record({
    usage: {
      groupId: group,
      contextKind: "execution",
      provider: "ollama",
      model: "llama3",
      location: "local",
      role: "delegate",
      keyId: null,
      keyAlias: null,
      inputTokens: 3_000,
      outputTokens: 1_000,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      durationMs: 1_000,
      ttftMs: 100,
      status: "ok",
      errorType: null,
      createdAt: Date.now(),
    },
    link: { kind: "execution", executionId: execution.id, nodeId: "count_step" },
  });
  await s.usage.attachHistory(group, historyId);

  const { data } = await (await listRuns(s.db, execution.id, {})).json();
  const d = data.runs[0].usage.delegation;
  assertEquals(d.orchestratorCalls, 1);
  assertEquals(d.orchestrator, { inputTokens: 600, outputTokens: 400 });
  assertEquals(d.delegated, { inputTokens: 3_000, outputTokens: 1_000 });
  // 4,000 delegated against 1,000 spent designing the graph.
  assertEquals(d.delegatedShare, 0.8);
  assertEquals(d.localShare, 1);
});
