import { assertAlmostEquals, assertEquals, assertMatch } from "@std/assert";
import {
  buildRunReport,
  compareRuns,
  comparisonToHtml,
  comparisonToJson,
  comparisonToMarkdown,
  reportToHtml,
  reportToJson,
  reportToMarkdown,
} from "../../../tests/llm-eval/report.ts";
import type { EvalVerdict } from "../../../tests/llm-eval/metrics.ts";

function verdict(overrides: Partial<EvalVerdict>): EvalVerdict {
  return {
    case_id: "case",
    category: "summarization",
    executor_model: "qwen3:8b",
    judge_model: "qwen3:8b",
    provider: "ollama",
    pass: true,
    judged_by: "llm-judge",
    score: 90,
    detail: "",
    input_tokens: 100,
    output_tokens: 50,
    duration_ms: 500,
    run_id: "run-1",
    ...overrides,
  };
}

Deno.test("buildRunReport - produces per-category summaries from a single run's verdicts", () => {
  const report = buildRunReport([
    verdict({ case_id: "a", pass: true, score: 90 }),
    verdict({ case_id: "b", pass: false, score: 20 }),
  ]);
  assertEquals(report.runId, "run-1");
  assertEquals(report.executorModel, "qwen3:8b");
  assertEquals(report.summaries[0].passed, 1);
  assertEquals(report.summaries[0].graded, 2);
});

Deno.test("reportToJson - round-trips the report as valid JSON", () => {
  const report = buildRunReport([verdict({})]);
  const parsed = JSON.parse(reportToJson(report));
  assertEquals(parsed.runId, "run-1");
});

Deno.test("reportToMarkdown - includes the run id and a category table row", () => {
  const report = buildRunReport([verdict({})]);
  const md = reportToMarkdown(report);
  assertMatch(md, /# Eval report: run-1/);
  assertMatch(md, /\| summarization \|/);
});

Deno.test("buildRunReport - summarizes the run: cases, judge, rubric, config, tokens, cost and time", () => {
  const report = buildRunReport([
    verdict({ case_id: "a", score: 90, judge_model: "lfm2.5", rubric_version: "v1", cost_usd: 0.002, config: { rag: "on" } }),
    verdict({ case_id: "b", pass: false, score: 40, judge_model: "lfm2.5", rubric_version: "v1", cost_usd: 0.003, config: { rag: "on" } }),
    verdict({ case_id: "c", judged_by: "unjudged", pass: false, score: undefined, judge_model: "lfm2.5", cost_usd: 0 }),
  ]);
  assertEquals(report.judgeModels, ["lfm2.5"]);
  assertEquals(report.rubricVersions, ["v1"]);
  assertEquals(report.config, { rag: "on" });
  assertEquals(report.totals.cases, 3);
  assertEquals(report.totals.graded, 2);
  assertEquals(report.totals.passed, 1);
  assertEquals(report.totals.unjudged, 1);
  assertEquals(report.totals.avgScore, 65);
  assertEquals(report.totals.inputTokens, 300);
  assertAlmostEquals(report.totals.costUsd!, 0.005);
  assertEquals(report.unjudgedCases.map((v) => v.case_id), ["c"]);
});

Deno.test("buildRunReport - an unknown model price makes the cost unknown, not zero", () => {
  const report = buildRunReport([verdict({ cost_usd: 0.01 }), verdict({ case_id: "b", cost_usd: null })]);
  assertEquals(report.totals.costUsd, null);
  assertMatch(reportToMarkdown(report), /Cost: unknown/);
});

Deno.test("reportToMarkdown - includes per-case detail with score and the judge's justification", () => {
  const md = reportToMarkdown(
    buildRunReport([
      verdict({ case_id: "summarize the Amazon", score: 85, detail: "Covers size and deforestation." }),
      verdict({ case_id: "c", judged_by: "unjudged", pass: false, score: undefined, detail: "judge format error" }),
    ]),
  );
  assertMatch(md, /\| summarize the Amazon \| summarization \| PASS \| 85 \|.*Covers size and deforestation\. \|/);
  assertMatch(md, /## Unjudged cases[\s\S]*- c: judge format error/);
});

Deno.test("reportToHtml - escapes run id content and includes a table", () => {
  const report = buildRunReport([verdict({ run_id: "<script>" })]);
  const html = reportToHtml(report);
  assertMatch(html, /&lt;script&gt;/);
  assertEquals(html.includes("<script>"), false);
});

Deno.test("compareRuns - requires at least 2 runs", () => {
  let threw = false;
  try {
    compareRuns([[verdict({})]]);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("compareRuns - lists a different model as what sets the runs apart, not as a warning", () => {
  const runA = [verdict({ run_id: "a", executor_model: "qwen3:8b" })];
  const runB = [verdict({ run_id: "b", executor_model: "llama3:8b" })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.differences, ["Model: qwen3:8b vs llama3:8b"]);
  assertEquals(comparison.warnings, []);
});

Deno.test("compareRuns - lists configuration differences (e.g. RAG, token optimization)", () => {
  const runA = [verdict({ run_id: "a", config: { rag: "off", "token-opt": "off" } })];
  const runB = [verdict({ run_id: "b", config: { rag: "on", "token-opt": "off" } })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.differences, ["Config 'rag': off vs on"]);
});

Deno.test("compareRuns - marks a category run on different case sets as not comparable", () => {
  const runA = [verdict({ run_id: "a", cases_version: "set-1" })];
  const runB = [verdict({ run_id: "b", cases_version: "set-2" })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.categories[0].comparable, false);
  assertEquals(comparison.warnings.some((w) => w.startsWith("Not comparable")), true);
});

Deno.test("compareRuns - computes score, tokens, cost and time deltas vs the first run", () => {
  const runA = [
    verdict({ run_id: "a", case_id: "x", score: 60, input_tokens: 100, output_tokens: 50, cost_usd: 0.01, duration_ms: 1000 }),
    verdict({ run_id: "a", case_id: "y", score: 80, input_tokens: 100, output_tokens: 50, cost_usd: 0.01, duration_ms: 1000 }),
  ];
  const runB = [
    verdict({ run_id: "b", case_id: "x", score: 90, input_tokens: 50, output_tokens: 25, cost_usd: 0.005, duration_ms: 500 }),
    verdict({ run_id: "b", case_id: "y", score: 90, input_tokens: 50, output_tokens: 25, cost_usd: 0.005, duration_ms: 500 }),
  ];
  const { categories, cases } = compareRuns([runA, runB]);
  const delta = categories[0].deltas[1]!;
  assertEquals(categories[0].deltas[0], undefined);
  assertEquals(delta.avgScore, 20);
  assertEquals(delta.tokens, -150);
  assertAlmostEquals(delta.costUsd!, -0.01);
  assertEquals(delta.durationMs, -1000);
  assertEquals(cases.find((c) => c.caseId === "x")?.scoreDelta, 30);
});

Deno.test("compareRuns - only counts judges that actually graded cases", () => {
  // Exact-match verdicts carry the executor as judge_model; that's not a judge.
  const runA = [verdict({ run_id: "a", judged_by: "exact", judge_model: "qwen3:8b", score: undefined })];
  const runB = [verdict({ run_id: "b", judged_by: "exact", judge_model: "llama3:8b", score: undefined })];
  assertEquals(compareRuns([runA, runB]).warnings, []);
});

Deno.test("compareRuns - lists unjudged cases apart and keeps them out of the averages", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", score: 80 }), verdict({ run_id: "a", case_id: "y", score: 80 })];
  const runB = [
    verdict({ run_id: "b", case_id: "x", score: 80 }),
    verdict({ run_id: "b", case_id: "y", judged_by: "unjudged", pass: false, score: undefined, detail: "bad format" }),
  ];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.unjudgedCases, [{ runId: "b", caseId: "y", detail: "bad format" }]);
  assertEquals(comparison.categories[0].perRun[1]?.passRate, 1);
  assertEquals(comparison.categories[0].perRun[1]?.avgScore, 80);
});

Deno.test("compareRuns - flags different judge models used across runs", () => {
  const runA = [verdict({ run_id: "a", judge_model: "qwen3:8b" })];
  const runB = [verdict({ run_id: "b", judge_model: "claude-sonnet-5" })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.warnings.some((w) => w.includes("different judge models")), true);
});

Deno.test("compareRuns - flags different rubric versions used across runs", () => {
  const runA = [verdict({ run_id: "a", rubric_version: "v1" })];
  const runB = [verdict({ run_id: "b", rubric_version: "v2" })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.warnings.some((w) => w.includes("different rubric versions")), true);
});

Deno.test("compareRuns - flags a run missing a case present in the other run", () => {
  const runA = [verdict({ run_id: "a", case_id: "x" }), verdict({ run_id: "a", case_id: "y" })];
  const runB = [verdict({ run_id: "b", case_id: "x" })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.warnings.some((w) => w.includes("missing 1 case")), true);
});

Deno.test("compareRuns - detects a case that newly fails between runs", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", pass: true, score: 90 })];
  const runB = [verdict({ run_id: "b", case_id: "x", pass: false, score: 20 })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.changedCases.length, 1);
  assertEquals(comparison.changedCases[0].kind, "newly-failing");
});

Deno.test("compareRuns - detects a case that newly passes between runs", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", pass: false, score: 20 })];
  const runB = [verdict({ run_id: "b", case_id: "x", pass: true, score: 90 })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.changedCases[0].kind, "newly-passing");
});

Deno.test("compareRuns - detects a significant score change even when pass/fail stays the same", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", pass: true, score: 95 })];
  const runB = [verdict({ run_id: "b", case_id: "x", pass: true, score: 80 })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.changedCases[0].kind, "score-changed");
});

Deno.test("compareRuns - a small score change (below threshold) is not reported as changed", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", pass: true, score: 95 })];
  const runB = [verdict({ run_id: "b", case_id: "x", pass: true, score: 90 })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.changedCases.length, 0);
});

Deno.test("compareRuns - an unchanged case is omitted from changedCases", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", pass: true, score: 90 })];
  const runB = [verdict({ run_id: "b", case_id: "x", pass: true, score: 90 })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.changedCases.length, 0);
});

Deno.test("compareRuns - an unjudged case on either side is excluded from change detection", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", judged_by: "unjudged", pass: false, score: undefined })];
  const runB = [verdict({ run_id: "b", case_id: "x", pass: true, score: 90 })];
  const comparison = compareRuns([runA, runB]);
  assertEquals(comparison.changedCases.length, 0);
});

Deno.test("compareRuns - supports comparing 3+ runs at once, using first vs last for change detection", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", pass: true, score: 90 })];
  const runB = [verdict({ run_id: "b", case_id: "x", pass: true, score: 92 })];
  const runC = [verdict({ run_id: "c", case_id: "x", pass: false, score: 10 })];
  const comparison = compareRuns([runA, runB, runC]);
  assertEquals(comparison.runIds, ["a", "b", "c"]);
  assertEquals(comparison.changedCases[0].fromRun, "a");
  assertEquals(comparison.changedCases[0].toRun, "c");
  assertEquals(comparison.changedCases[0].kind, "newly-failing");
});

Deno.test("comparisonToJson - round-trips the comparison as valid JSON", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", pass: true })];
  const runB = [verdict({ run_id: "b", case_id: "x", pass: false, score: 10 })];
  const parsed = JSON.parse(comparisonToJson(compareRuns([runA, runB])));
  assertEquals(parsed.runIds, ["a", "b"]);
});

Deno.test("comparisonToMarkdown - shows what differs and warns when judges differ", () => {
  const runA = [verdict({ run_id: "a", executor_model: "qwen3:8b", judge_model: "lfm2.5" })];
  const runB = [verdict({ run_id: "b", executor_model: "llama3:8b", judge_model: "claude-sonnet-5" })];
  const md = comparisonToMarkdown(compareRuns([runA, runB]));
  assertMatch(md, /## What differs between the runs\n\n- Model: qwen3:8b vs llama3:8b/);
  assertMatch(md, /## Warnings/);
  assertMatch(md, /### Avg judge score/);
});

Deno.test("comparisonToHtml - lets you open a case to read the judge's justification", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", detail: "Covers the key facts." })];
  const runB = [verdict({ run_id: "b", case_id: "x", detail: "Invents a date." })];
  const html = comparisonToHtml(compareRuns([runA, runB]));
  assertMatch(html, /<details><summary>PASS \(90\)<\/summary>Covers the key facts\.<\/details>/);
  assertMatch(html, /Invents a date\./);
});

Deno.test("comparisonToMarkdown - says no cases changed when the runs are identical", () => {
  const runA = [verdict({ run_id: "a", case_id: "x", pass: true, score: 90 })];
  const runB = [verdict({ run_id: "b", case_id: "x", pass: true, score: 90 })];
  const md = comparisonToMarkdown(compareRuns([runA, runB]));
  assertMatch(md, /No case changed pass\/fail status/);
});

Deno.test("comparisonToHtml - escapes run id content in the comparison title", () => {
  const runA = [verdict({ run_id: "<a>" })];
  const runB = [verdict({ run_id: "<b>" })];
  const html = comparisonToHtml(compareRuns([runA, runB]));
  assertEquals(html.includes("<a>") && html.includes("<b>"), false);
  assertMatch(html, /&lt;a&gt;/);
});
