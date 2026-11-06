import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  buildMetricResults,
  checkStaleness,
  classifyLevel,
  emptyProfile,
  estimateRun,
  loadProfile,
  mergeIntoProfile,
  profileStatus,
  saveProfile,
  LOW_CONFIDENCE_MIN_CASES,
  type MetricResult,
} from "../../../tests/llm-eval/profile.ts";
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
    score: 95,
    rubric_version: "v1",
    detail: "",
    input_tokens: 100,
    output_tokens: 50,
    duration_ms: 500,
    run_id: "run-1",
    ...overrides,
  };
}

Deno.test("classifyLevel - maps a value to the right band at each threshold boundary", () => {
  assertEquals(classifyLevel(0.95), "very-good");
  assertEquals(classifyLevel(0.9), "very-good");
  assertEquals(classifyLevel(0.89), "good");
  assertEquals(classifyLevel(0.7), "good");
  assertEquals(classifyLevel(0.69), "fair");
  assertEquals(classifyLevel(0.5), "fair");
  assertEquals(classifyLevel(0.49), "poor");
  assertEquals(classifyLevel(0), "poor");
});

Deno.test("buildMetricResults - uses avgScore (normalized) for judge-scored categories", () => {
  const [result] = buildMetricResults(
    [verdict({ score: 90 }), verdict({ score: 100 })],
    "v1",
  );
  assertEquals(result.value, 0.95);
  assertEquals(result.level, "very-good");
});

Deno.test("buildMetricResults - uses passRate for exact-match categories without a score", () => {
  const [result] = buildMetricResults(
    [
      verdict({ category: "routing", judged_by: "exact", score: undefined, pass: true }),
      verdict({ category: "routing", judged_by: "exact", score: undefined, pass: false }),
    ],
    "v1",
  );
  assertEquals(result.value, 0.5);
  assertEquals(result.level, "fair");
});

Deno.test("buildMetricResults - flags low confidence when fewer than the minimum cases were graded", () => {
  const verdicts = Array.from({ length: LOW_CONFIDENCE_MIN_CASES - 1 }, () => verdict({}));
  const [result] = buildMetricResults(verdicts, "v1");
  assertEquals(result.lowConfidence, true);
  assertEquals(result.casesGraded, LOW_CONFIDENCE_MIN_CASES - 1);
});

Deno.test("buildMetricResults - is not low confidence once the minimum is reached", () => {
  const verdicts = Array.from({ length: LOW_CONFIDENCE_MIN_CASES }, () => verdict({}));
  const [result] = buildMetricResults(verdicts, "v1");
  assertEquals(result.lowConfidence, false);
});

Deno.test("buildMetricResults - records how many cases were unjudged, separate from the graded count", () => {
  const verdicts = [
    verdict({ score: 90 }),
    verdict({ judged_by: "unjudged", score: undefined, pass: false }),
  ];
  const [result] = buildMetricResults(verdicts, "v1");
  assertEquals(result.casesGraded, 1);
  assertEquals(result.casesUnjudged, 1);
});

Deno.test("buildMetricResults - carries the judge model and rubric version used", () => {
  const [result] = buildMetricResults([verdict({ judge_model: "claude-sonnet-5", rubric_version: "v2" })], "v1");
  assertEquals(result.judgeModel, "claude-sonnet-5");
  assertEquals(result.rubricVersion, "v2");
});

Deno.test("buildMetricResults - omits judge model/rubric version when verdicts in the category disagree", () => {
  const [result] = buildMetricResults(
    [verdict({ judge_model: "a" }), verdict({ judge_model: "b" })],
    "v1",
  );
  assertEquals(result.judgeModel, undefined);
});

Deno.test("mergeIntoProfile - sets latest and appends to history without mutating the input", () => {
  const profile = emptyProfile("qwen3:8b");
  const [result] = buildMetricResults([verdict({})], "v1");
  const updated = mergeIntoProfile(profile, [result]);

  assertEquals(updated.latest.summarization, result);
  assertEquals(updated.history.summarization, [result]);
  assertEquals(profile.latest.summarization, undefined);
});

Deno.test("mergeIntoProfile - a second run appends to history and replaces latest", () => {
  const profile = emptyProfile("qwen3:8b");
  const [first] = buildMetricResults([verdict({ score: 60 })], "v1");
  const afterFirst = mergeIntoProfile(profile, [first]);

  const [second] = buildMetricResults([verdict({ score: 95 })], "v1");
  const afterSecond = mergeIntoProfile(afterFirst, [second]);

  assertEquals(afterSecond.latest.summarization.value, 0.95);
  assertEquals(afterSecond.history.summarization.length, 2);
  assertEquals(afterSecond.history.summarization[0].value, 0.6);
});

Deno.test("checkStaleness - flags a changed case set version", () => {
  const { stale, reasons } = checkStaleness({ casesVersion: "v1" }, { casesVersion: "v2" });
  assertEquals(stale, true);
  assertEquals(reasons.length, 1);
});

Deno.test("checkStaleness - flags a changed judge model", () => {
  const { stale, reasons } = checkStaleness(
    { casesVersion: "v1", judgeModel: "qwen3:8b" },
    { casesVersion: "v1", judgeModel: "claude-sonnet-5" },
  );
  assertEquals(stale, true);
  assertEquals(reasons[0].includes("judge model"), true);
});

Deno.test("checkStaleness - flags a changed rubric version", () => {
  const { stale, reasons } = checkStaleness(
    { casesVersion: "v1", rubricVersion: "v1" },
    { casesVersion: "v1", rubricVersion: "v2" },
  );
  assertEquals(stale, true);
  assertEquals(reasons[0].includes("rubric version"), true);
});

Deno.test("checkStaleness - reports fresh when nothing changed", () => {
  const { stale, reasons } = checkStaleness(
    { casesVersion: "v1", judgeModel: "qwen3:8b", rubricVersion: "v1" },
    { casesVersion: "v1", judgeModel: "qwen3:8b", rubricVersion: "v1" },
  );
  assertEquals(stale, false);
  assertEquals(reasons.length, 0);
});

Deno.test("checkStaleness - flags a changed model version (e.g. a re-pulled Ollama build)", () => {
  const result = checkStaleness(
    { casesVersion: "c1", modelVersion: "sha-old" },
    { casesVersion: "c1", modelVersion: "sha-new" },
  );
  assertEquals(result.stale, true);
  assertEquals(result.reasons[0].startsWith("model version changed"), true);
});

function metric(overrides: Partial<MetricResult>): MetricResult {
  return {
    category: "routing",
    value: 0.8,
    level: "good",
    casesGraded: 6,
    casesUnjudged: 0,
    lowConfidence: false,
    date: "2026-11-01T00:00:00.000Z",
    casesVersion: "c1",
    inputTokens: 1000,
    outputTokens: 100,
    durationMs: 500,
    ...overrides,
  };
}

Deno.test("profileStatus - reports stale metrics and judge changes in the evolution", () => {
  const first = metric({ category: "summarization", judgeModel: "lfm2.5" });
  const second = metric({ category: "summarization", judgeModel: "claude-sonnet-5" });
  const profile = {
    model: "qwen3:8b",
    latest: { summarization: second, routing: metric({}) },
    history: { summarization: [first, second], routing: [metric({})] },
  };
  const status = profileStatus(profile, { casesVersions: { summarization: "c1", routing: "c2" } });
  assertEquals(status.summarization.stale, false);
  assertEquals(status.summarization.judgeChangedSincePrevious, true);
  assertEquals(status.routing.stale, true);
  assertEquals(status.routing.judgeChangedSincePrevious, false);
});

Deno.test("buildMetricResults - records cost, model version and the run it came from", () => {
  const [result] = buildMetricResults(
    [verdict({ cost_usd: 0.01 }), verdict({ case_id: "b", cost_usd: 0.02 })],
    { summarization: "c9" },
    { modelVersion: "sha-1", runId: "run-7" },
  );
  assertEquals(result.casesVersion, "c9");
  assertEquals(result.modelVersion, "sha-1");
  assertEquals(result.runId, "run-7");
  assertAlmostEquals(result.costUsd!, 0.03);
});

Deno.test("estimateRun - a local model needs no confirmation and costs nothing", () => {
  const estimate = estimateRun(
    { provider: "ollama", model: "qwen3:8b" },
    { provider: "ollama", model: "lfm2.5" },
    ["routing", "summarization"],
    emptyProfile("qwen3:8b"),
    ["summarization"],
  );
  assertEquals(estimate.requiresConfirmation, false);
  assertEquals(estimate.totalCostUsd, 0);
  assertEquals(estimate.suites.map((s) => s.basedOn), ["defaults", "defaults"]);
});

Deno.test("estimateRun - a cloud model needs confirmation and uses the model's own token history", () => {
  const profile = { model: "anthropic:claude-sonnet-4-5", latest: { routing: metric({ inputTokens: 2000, outputTokens: 200 }) }, history: {} };
  const estimate = estimateRun(
    { provider: "anthropic", model: "claude-sonnet-4-5" },
    undefined,
    ["routing"],
    profile,
    ["summarization"],
  );
  assertEquals(estimate.requiresConfirmation, true);
  assertEquals(estimate.suites[0].basedOn, "history");
  const cases = estimate.suites[0].cases;
  assertEquals(estimate.suites[0].inputTokens, 2000 * cases);
  assertAlmostEquals(estimate.totalCostUsd!, (2000 * cases * 3 + 200 * cases * 15) / 1_000_000);
});

Deno.test("estimateRun - a local executor graded by a cloud judge still needs confirmation", () => {
  const estimate = estimateRun(
    { provider: "ollama", model: "qwen3:8b" },
    { provider: "anthropic", model: "claude-haiku-4-5" },
    ["summarization"],
    emptyProfile("qwen3:8b"),
    ["summarization"],
  );
  assertEquals(estimate.requiresConfirmation, true);
  assertEquals((estimate.totalCostUsd ?? 0) > 0, true);
});

Deno.test("estimateRun - an unknown cloud price makes the estimate unknown, not free", () => {
  const estimate = estimateRun(
    { provider: "google", model: "some-unlisted-model" },
    undefined,
    ["routing"],
    emptyProfile("google:some-unlisted-model"),
    [],
  );
  assertEquals(estimate.totalCostUsd, null);
});

Deno.test("saveProfile/loadProfile - round-trips through the eval dir without leaving a temp file", async () => {
  const dir = await Deno.makeTempDir();
  const previous = Deno.env.get("HIVEAI_EVAL_DIR");
  Deno.env.set("HIVEAI_EVAL_DIR", dir);
  try {
    const profile = mergeIntoProfile(emptyProfile("qwen3:8b"), [metric({})]);
    const path = await saveProfile("qwen3-8b", profile);
    assertEquals(await loadProfile("qwen3-8b", "qwen3:8b"), profile);
    const files = [...Deno.readDirSync(dir + "/profiles")].map((f) => f.name);
    assertEquals(files, ["qwen3-8b.json"]);
    assertEquals(path.endsWith("qwen3-8b.json"), true);
  } finally {
    if (previous === undefined) Deno.env.delete("HIVEAI_EVAL_DIR");
    else Deno.env.set("HIVEAI_EVAL_DIR", previous);
    await Deno.remove(dir, { recursive: true });
  }
});
