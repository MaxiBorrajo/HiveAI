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

Deno.test("the run key does not depend on the order or repeats", async () => {
  const { runKeyOf } = await import("../../../../../modules/executions/use-cases/judge-chat.ts");
  assertEquals(runKeyOf([15, 12]), "12,15");
  assertEquals(runKeyOf([12, 15, 12]), "12,15");
});
