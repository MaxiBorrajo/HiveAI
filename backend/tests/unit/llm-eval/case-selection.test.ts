import { assertEquals } from "@std/assert";
import { QUICK_CASES_PER_CATEGORY, selectCases } from "../../../tests/llm-eval/caseSelection.ts";
import { suiteCaseCount } from "../../../tests/llm-eval/casesVersion.ts";
import { buildMetricResults } from "../../../tests/llm-eval/profile.ts";
import { buildProfileArgs } from "../../../modules/models/use-cases/eval-profile-jobs.ts";
import { parseEvalRunRequest } from "../../../modules/models/use-cases/get-model-eval-profile.ts";
import type { EvalVerdict } from "../../../tests/llm-eval/metrics.ts";

const cases = [
  ...Array.from({ length: 15 }, (_, i) => ({ id: `a${i}`, category: "a" })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, category: "b" })),
];

Deno.test("selectCases - the full run keeps every case", () => {
  assertEquals(selectCases(cases, (c) => c.category, false), cases);
});

Deno.test("selectCases - a quick run takes a few per category, spread from first to last", () => {
  const picked = selectCases(cases, (c) => c.category, true).map((c) => c.id);

  assertEquals(picked, ["a0", "a4", "a7", "a11", "a14", "b0", "b1", "b2"]);
  assertEquals(selectCases(cases, (c) => c.category, true).map((c) => c.id), picked);
});

Deno.test("suiteCaseCount - quick mode counts 5 cases per routing category", () => {
  assertEquals(suiteCaseCount("routing", true), 5 * QUICK_CASES_PER_CATEGORY);
  assertEquals(suiteCaseCount("summarization", true), QUICK_CASES_PER_CATEGORY);
  assertEquals(suiteCaseCount("routing") > suiteCaseCount("routing", true), true);
});

Deno.test("a quick run reaches the profile runner and is marked on its results", () => {
  const { request } = parseEvalRunRequest({
    executor: { provider: "ollama", model: "qwen3:8b" },
    suites: ["routing"],
    quick: true,
  });
  assertEquals(request?.quick, true);
  assertEquals(buildProfileArgs({ ...request!, confirm: false }).includes("--quick"), true);
  assertEquals(buildProfileArgs({ ...request!, quick: false, confirm: false }).includes("--quick"), false);

  const verdict = { category: "routing", judged_by: "exact", pass: true } as EvalVerdict;
  assertEquals(buildMetricResults([verdict], "v1", { quick: true })[0].quick, true);
  assertEquals(buildMetricResults([verdict], "v1")[0].quick, undefined);
});
