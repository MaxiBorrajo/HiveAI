import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildJudgeChatPreamble, parseJudgeFocus } from "../../../../../modules/executions/use-cases/judge-chat.ts";
import type { RunSummary } from "../../../../../modules/executions/use-cases/list-runs.ts";

function run(over: Partial<RunSummary>): RunSummary {
  return {
    historyId: 1,
    iteration: 1,
    createdAt: 0,
    graphId: 1,
    result: "the answer",
    input: { topic: "bees" },
    usage: null,
    grades: [],
    trigger: "manual",
    ...over,
  };
}

Deno.test("the preamble describes every run with its input, result and grade", () => {
  const text = buildJudgeChatPreamble("Flow", [
    run({}),
    run({
      historyId: 2,
      iteration: 2,
      grades: [{
        historyId: 2,
        status: "failed",
        score: null,
        reasoning: null,
        error: "bad key",
        judge: { provider: "ollama", model: "j", keyId: null, version: 1 },
        rubric: { id: 1, version: 3 },
        createdAt: 0,
      }],
    }),
  ]);
  assertStringIncludes(text, '"Flow"');
  assertStringIncludes(text, "bees");
  assertStringIncludes(text, "not graded");
  assertStringIncludes(text, "unevaluated");
  assertEquals(text.match(/### Run #/g)?.length, 2);
});

Deno.test("the focus steers the preamble and unknown values are ignored", () => {
  assertEquals(parseJudgeFocus("tokens"), "tokens");
  assertEquals(parseJudgeFocus("nope"), null);
  const focused = buildJudgeChatPreamble("Flow", [run({})], "tokens");
  assertStringIncludes(focused, "token usage by model");
  const plain = buildJudgeChatPreamble("Flow", [run({})]);
  assertEquals(plain.includes("The user is looking at"), false);
});

Deno.test("a judge chat is found by its set of runs, whatever the order or repeats", async () => {
  const { initORM } = await import("../../../../../infrastructure/db/orm.ts");
  const { ChatRepository } = await import("../../../../../infrastructure/db/repositories/chat-repository.ts");
  const { ExecutionRepository } = await import("../../../../../infrastructure/db/repositories/execution-repository.ts");
  const db = await initORM(await Deno.makeTempDir());
  const executions = new ExecutionRepository(db);
  const execution = await executions.create({ name: "flow", createdAt: 1, updatedAt: 1 });
  const runs = [];
  for (let iteration = 1; iteration <= 3; iteration++) {
    runs.push((await executions.createHistory({
      executionId: execution.id,
      iteration,
      result: {},
      createdAt: 1,
    })).id);
  }
  const chats = new ChatRepository(db);
  const chatId = await chats.create({
    title: "Judge",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    executionId: execution.id,
  }, [runs[0], runs[1]]);

  assertEquals((await chats.findByRunComparison(execution.id, [runs[1], runs[0], runs[0]]))?.id, chatId);
  assertEquals(await chats.findByRunComparison(execution.id, [runs[0]]), undefined);
  assertEquals(await chats.findByRunComparison(execution.id, runs), undefined);
});
