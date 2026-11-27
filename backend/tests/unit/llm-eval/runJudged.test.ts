import { assertEquals } from "@std/assert";
import { toVerdictFromJudgeOutcome } from "../../../tests/llm-eval/runJudged.ts";
import { JudgeFormatError } from "../../../tests/llm-eval/judge.ts";

type Base = Parameters<typeof toVerdictFromJudgeOutcome>[0];

function baseVerdict(): Base {
  return {
    case_id: "summarization: condenses a long passage",
    category: "summarization",
    executor_model: "qwen3:8b",
    judge_model: "claude-sonnet-5",
    provider: "ollama",
    rubric_version: "v1",
    run_id: "test-run",
  };
}

const executorUsage = { inputTokens: 100, outputTokens: 50, durationMs: 1200 };
const judgeUsage = { inputTokens: 40, outputTokens: 10, durationMs: 300 };

Deno.test("toVerdictFromJudgeOutcome - a simulated passing judge produces an llm-judge verdict with score", () => {
  const verdict = toVerdictFromJudgeOutcome(
    baseVerdict(),
    { ok: true, judged: { pass: true, score: 92, reasoning: "Hits all key facts." } },
    executorUsage,
    judgeUsage,
  );

  assertEquals(verdict.judged_by, "llm-judge");
  assertEquals(verdict.pass, true);
  assertEquals(verdict.score, 92);
  assertEquals(verdict.detail, "Hits all key facts.");
});

Deno.test("toVerdictFromJudgeOutcome - the judge's usage is recorded apart from the evaluated model's", () => {
  const verdict = toVerdictFromJudgeOutcome(
    baseVerdict(),
    { ok: true, judged: { pass: true, score: 92, reasoning: "ok" } },
    executorUsage,
    judgeUsage,
  );

  assertEquals(verdict.input_tokens, 100);
  assertEquals(verdict.output_tokens, 50);
  assertEquals(verdict.duration_ms, 1200);
  assertEquals(verdict.judge_input_tokens, 40);
  assertEquals(verdict.judge_output_tokens, 10);
  assertEquals(verdict.judge_duration_ms, 300);
});

Deno.test("toVerdictFromJudgeOutcome - a simulated failing judge still produces an llm-judge verdict, not unjudged", () => {
  const verdict = toVerdictFromJudgeOutcome(
    baseVerdict(),
    { ok: true, judged: { pass: false, score: 15, reasoning: "Missed the main point." } },
    executorUsage,
    judgeUsage,
  );

  assertEquals(verdict.judged_by, "llm-judge");
  assertEquals(verdict.pass, false);
  assertEquals(verdict.score, 15);
});

Deno.test("toVerdictFromJudgeOutcome - a JudgeFormatError (bad response format) is recorded as unjudged, not a fail", () => {
  const error = new JudgeFormatError("I think it's pretty good honestly!");
  const verdict = toVerdictFromJudgeOutcome(baseVerdict(), { ok: false, error }, executorUsage);

  assertEquals(verdict.judged_by, "unjudged");
  assertEquals(verdict.pass, false); // pass is irrelevant for unjudged but must not be true
  assertEquals(verdict.score, undefined);
  assertEquals(verdict.detail.includes("did not match the expected format"), true);
});

Deno.test("toVerdictFromJudgeOutcome - an unexpected error (e.g. network) is also recorded as unjudged, not a crash", () => {
  const error = new Error("ECONNREFUSED");
  const verdict = toVerdictFromJudgeOutcome(baseVerdict(), { ok: false, error }, executorUsage);

  assertEquals(verdict.judged_by, "unjudged");
  assertEquals(verdict.detail, "judge threw: ECONNREFUSED");
});

Deno.test("toVerdictFromJudgeOutcome - an unjudged verdict only counts the executor's usage, not a phantom judge call", () => {
  const error = new JudgeFormatError("garbage");
  const verdict = toVerdictFromJudgeOutcome(baseVerdict(), { ok: false, error }, executorUsage);

  assertEquals(verdict.input_tokens, executorUsage.inputTokens);
  assertEquals(verdict.output_tokens, executorUsage.outputTokens);
  assertEquals(verdict.duration_ms, executorUsage.durationMs);
});

Deno.test("toVerdictFromJudgeOutcome - rubric_version from the case is preserved on the verdict", () => {
  const verdict = toVerdictFromJudgeOutcome(
    baseVerdict(),
    { ok: true, judged: { pass: true, score: 80, reasoning: "ok" } },
    executorUsage,
    judgeUsage,
  );
  assertEquals(verdict.rubric_version, "v1");
});
