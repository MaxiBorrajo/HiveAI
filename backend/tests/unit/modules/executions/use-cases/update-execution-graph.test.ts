import { assertEquals, assertStringIncludes } from "@std/assert";
import { initORM } from "../../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../../infrastructure/db/repositories/execution-repository.ts";
import { HiveMicrokernel } from "../../../../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../../../../plugins/counter/index.ts";
import { updateExecutionGraph } from "../../../../../modules/executions/use-cases/update-execution-graph.ts";
import type { LangGraphAbstraction } from "../../../../../core/ai/visual-builder/types.ts";

/** The counter plugin is installed but switched off, as it may be for the chat. */
async function setup() {
  const db = await initORM(await Deno.makeTempDir());
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: await Deno.makeTempDir() });
  await hive.register(new CounterPlugin());
  const executions = new ExecutionRepository(db);
  const execution = await executions.create({
    name: "edit-by-hand",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { db, hive, executionId: execution.id };
}

function graphUsing(pluginId: string): LangGraphAbstraction {
  return {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      {
        id: "count_step",
        name: "Count Step",
        type: "plugin",
        config: {
          pluginId,
          inputMapping: { name: "counter_name", action: "action" },
          outputKey: "count_result",
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        config: { output: { type: "text", contentKey: "count_result" } },
      },
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

Deno.test("updateExecutionGraph - saves a graph that uses an installed plugin switched off for the chat", async () => {
  const s = await setup();
  const response = await updateExecutionGraph(s.db, s.hive, s.executionId, graphUsing("counter"), undefined, {});
  const body = await response.json();
  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.success, true);
});

Deno.test("updateExecutionGraph - still refuses a plugin that is not installed", async () => {
  const s = await setup();
  const response = await updateExecutionGraph(s.db, s.hive, s.executionId, graphUsing("not_installed"), undefined, {});
  const body = await response.json();
  assertEquals(response.status, 422);
  assertStringIncludes(JSON.stringify(body), "not_installed");
});
