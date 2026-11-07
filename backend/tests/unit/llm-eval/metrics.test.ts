import { assertEquals } from "@std/assert";
import { summarizeByCategory } from "../../../tests/llm-eval/metrics.ts";
import type { EvalVerdict } from "../../../tests/llm-eval/metrics.ts";

function verdict(overrides: Partial<EvalVerdict>): EvalVerdict {
  return {
    case_id: "case",
    category: "summarization",
    executor_model: "qwen3:8b",
    judge_model: "qwen3:8b",
    provider: "ollama",
    pass: true,
    judged_by: "exact",
    detail: "",
    input_tokens: 100,
    output_tokens: 50,
    duration_ms: 500,
    run_id: "run-1",
    ...overrides,
  };
}

Deno.test("summarizeByCategory - unjudged cases don't count toward passRate", () => {
  const verdicts: EvalVerdict[] = [
    verdict({ judged_by: "llm-judge", pass: true, score: 90 }),
    verdict({ judged_by: "llm-judge", pass: false, score: 20 }),
    verdict({ judged_by: "unjudged", pass: false, detail: "bad format" }),
  ];

  const [summary] = summarizeByCategory(verdicts);
  assertEquals(summary.total, 3);
  assertEquals(summary.graded, 2);
  assertEquals(summary.unjudged, 1);
  assertEquals(summary.passed, 1);
  assertEquals(summary.passRate, 0.5);
});

Deno.test("summarizeByCategory - a category that is entirely unjudged has passRate 0, not NaN", () => {
  const verdicts: EvalVerdict[] = [
    verdict({ judged_by: "unjudged", pass: false }),
    verdict({ judged_by: "unjudged", pass: false }),
  ];

  const [summary] = summarizeByCategory(verdicts);
  assertEquals(summary.graded, 0);
  assertEquals(summary.passRate, 0);
  assertEquals(summary.unjudged, 2);
});

Deno.test("summarizeByCategory - avgScore is computed only from scored cases and omitted otherwise", () => {
  const judged: EvalVerdict[] = [
    verdict({ judged_by: "llm-judge", pass: true, score: 80 }),
    verdict({ judged_by: "llm-judge", pass: true, score: 100 }),
  ];
  const [withScores] = summarizeByCategory(judged);
  assertEquals(withScores.avgScore, 90);

  const exact: EvalVerdict[] = [verdict({ judged_by: "exact", pass: true })];
  const [withoutScores] = summarizeByCategory(exact);
  assertEquals(withoutScores.avgScore, undefined);
});

Deno.test("summarizeByCategory - exact-match verdicts keep working unaffected by judge fields", () => {
  const verdicts: EvalVerdict[] = [
    verdict({ judged_by: "exact", pass: true }),
    verdict({ judged_by: "exact", pass: false }),
  ];
  const [summary] = summarizeByCategory(verdicts);
  assertEquals(summary.passed, 1);
  assertEquals(summary.graded, 2);
  assertEquals(summary.passRate, 0.5);
});
