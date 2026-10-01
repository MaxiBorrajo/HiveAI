import { assertEquals, assertExists } from "@std/assert";
import { initORM } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../../../plugins/counter/index.ts";
import { runExecution } from "./index.ts";
import type { LangGraphAbstraction } from "../../../../core/ai/visual-builder/types.ts";

async function makeHiveWithCounter() {
  const tempDir = await Deno.makeTempDir();
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: tempDir });
  await hive.register(new CounterPlugin());
  await hive.activate("counter");
  return hive;
}

async function makeRepo() {
  const tempDir = await Deno.makeTempDir();
  const db = await initORM(tempDir);
  return new ExecutionRepository(db);
}

// A minimal single-plugin-node graph: start -> count_step (counter plugin) -> end
function counterGraph(counterName: string): LangGraphAbstraction {
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

async function readSseStream(response: Response): Promise<{ events: string[]; done: any }> {
  const text = await response.text();
  const blocks = text.split("\n\n").filter((b) => b.trim());
  const events: string[] = [];
  let done: any = undefined;
  for (const block of blocks) {
    const eventLine = block.split("\n").find((l) => l.startsWith("event: "));
    const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
    if (!eventLine || !dataLine) continue;
    const eventName = eventLine.replace("event: ", "");
    events.push(eventName);
    if (eventName === "done") {
      done = JSON.parse(dataLine.replace("data: ", ""));
    }
  }
  return { events, done };
}

Deno.test("runExecution - returns 404 when the execution id does not exist", async () => {
  const repo = await makeRepo();
  const hive = await makeHiveWithCounter();
  const db = (repo as any).db;

  const res = await runExecution(db, hive, 999_999, {}, {});
  assertEquals(res.status, 404);
});

Deno.test("runExecution - returns 404 when the execution has no associated graph", async () => {
  const repo = await makeRepo();
  const hive = await makeHiveWithCounter();
  const db = (repo as any).db;

  const execution = await repo.create({
    name: "graphless",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const res = await runExecution(db, hive, execution.id, {}, {});
  assertEquals(res.status, 404);
});

Deno.test("runExecution - runs a single plugin node end to end and persists history", async () => {
  const repo = await makeRepo();
  const hive = await makeHiveWithCounter();
  const db = (repo as any).db;

  const execution = await repo.create({
    name: "counter-exec",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const graph = await repo.createGraph({
    executionId: execution.id,
    graph: counterGraph("run-execution-test-counter"),
    state: counterGraph("run-execution-test-counter").stateSchema,
    createdAt: Date.now(),
  });
  await repo.update(execution.id, { lastGraphId: graph.id });

  const res = await runExecution(
    db,
    hive,
    execution.id,
    { counter_name: "run-execution-test-counter", action: "increment" },
    {},
  );

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/event-stream");

  const { events, done } = await readSseStream(res);
  assertEquals(events.includes("done"), true);
  assertExists(done.historyId);
  assertEquals(done.iteration, 1);

  // The counter plugin's confirmation message should show up somewhere in the final result
  const resultStr = JSON.stringify(done.result);
  assertEquals(resultStr.includes("run-execution-test-counter"), true);

  // History must actually be persisted
  assertEquals(await repo.countHistories(execution.id), 1);
  const updatedExecution = await repo.findById(execution.id);
  assertEquals(updatedExecution?.lastResultId, done.historyId);
});

Deno.test("runExecution - a second run on the same execution increments the iteration counter", async () => {
  const repo = await makeRepo();
  const hive = await makeHiveWithCounter();
  const db = (repo as any).db;

  const execution = await repo.create({
    name: "counter-exec-2",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const graphAbstraction = counterGraph("run-execution-iter-counter");
  const graph = await repo.createGraph({
    executionId: execution.id,
    graph: graphAbstraction,
    state: graphAbstraction.stateSchema,
    createdAt: Date.now(),
  });
  await repo.update(execution.id, { lastGraphId: graph.id });

  const firstRes = await runExecution(
    db,
    hive,
    execution.id,
    { counter_name: "run-execution-iter-counter", action: "get" },
    {},
  );
  const { done: firstDone } = await readSseStream(firstRes);
  assertEquals(firstDone.iteration, 1);

  const secondRes = await runExecution(
    db,
    hive,
    execution.id,
    { counter_name: "run-execution-iter-counter", action: "get" },
    {},
  );
  const { done: secondDone } = await readSseStream(secondRes);
  assertEquals(secondDone.iteration, 2);
});

Deno.test("runExecution - a plugin node referencing an unregistered tool fails fast with a 500 (compileGraph's toolProvider.getTool throws before streaming starts)", async () => {
  const repo = await makeRepo();
  const hive = await makeHiveWithCounter();
  const db = (repo as any).db;

  const execution = await repo.create({
    name: "bad-tool-exec",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const badGraph: LangGraphAbstraction = {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      {
        id: "bad_step",
        name: "Bad Step",
        type: "plugin",
        config: { pluginId: "does-not-exist" },
      },
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "bad_step", isConditional: false },
      { id: "e2", source: "bad_step", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const graph = await repo.createGraph({
    executionId: execution.id,
    graph: badGraph,
    state: {},
    createdAt: Date.now(),
  });
  await repo.update(execution.id, { lastGraphId: graph.id });

  // NOTE: unlike a plugin failing mid-run (which streams an "error" SSE event),
  // an unregistered tool is caught synchronously by compileGraph's toolProvider
  // before the ReadableStream even starts, so it surfaces as a plain 500 JSON
  // response instead of an SSE stream.
  const res = await runExecution(db, hive, execution.id, {}, {});
  assertEquals(res.status, 500);
});
