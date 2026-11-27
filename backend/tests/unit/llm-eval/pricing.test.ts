import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { costUsd, findPrice, formatCost, sumCosts } from "../../../tests/llm-eval/pricing.ts";
import { annotateRun, parseConfigFlags } from "../../../tests/llm-eval/runMeta.ts";
import { suiteCasesVersion, suiteOfCategory } from "../../../tests/llm-eval/casesVersion.ts";
import type { EvalVerdict } from "../../../tests/llm-eval/metrics.ts";

Deno.test("findPrice - local models are free", () => {
  assertEquals(findPrice({ provider: "ollama", model: "qwen3:8b" }), { input: 0, output: 0 });
});

Deno.test("findPrice - matches a dated model id by its family prefix, longest prefix first", () => {
  assertEquals(findPrice({ provider: "anthropic", model: "claude-sonnet-4-5-20250929" }), { input: 3, output: 15 });
  assertEquals(findPrice({ provider: "google", model: "gemini-2.5-flash-lite-001" }), { input: 0.1, output: 0.4 });
});

Deno.test("costUsd - prices tokens per million and is null for an unknown model", () => {
  assertAlmostEquals(costUsd({ provider: "anthropic", model: "claude-haiku-4-5" }, 1_000_000, 100_000)!, 1.5);
  assertEquals(costUsd({ provider: "google", model: "unlisted" }, 10, 10), null);
});

Deno.test("sumCosts / formatCost - one unknown cost makes the total unknown", () => {
  assertEquals(sumCosts([0.1, 0.2, null]), null);
  assertAlmostEquals(sumCosts([0.1, 0.2])!, 0.3);
  assertEquals(formatCost(null), "unknown");
  assertEquals(formatCost(0), "$0");
  assertEquals(formatCost(0.0042), "$0.0042");
  assertEquals(formatCost(1.234), "$1.23");
});

Deno.test("parseConfigFlags - parses repeated key=value labels and rejects malformed ones", () => {
  assertEquals(parseConfigFlags(["rag=on", "token-opt = off"]), { rag: "on", "token-opt": "off" });
  assertEquals(parseConfigFlags(undefined), {});
  assertThrows(() => parseConfigFlags(["rag"]), Error, "key=value");
});

Deno.test("annotateRun - stamps cost, judge cost, case-set version and config on each verdict", () => {
  const base: EvalVerdict = {
    case_id: "x",
    category: "summarization",
    executor_model: "anthropic:claude-haiku-4-5",
    judge_model: "lfm2.5",
    provider: "anthropic",
    pass: true,
    judged_by: "llm-judge",
    score: 90,
    detail: "",
    input_tokens: 1_000_000,
    output_tokens: 0,
    duration_ms: 1,
    judge_input_tokens: 500,
    judge_output_tokens: 50,
    run_id: "r",
  };
  const [v] = annotateRun([base], {
    executorRef: { provider: "anthropic", model: "claude-haiku-4-5" },
    judgeRef: { provider: "ollama", model: "lfm2.5" },
    casesVersions: { summarization: "abc" },
    config: { rag: "off" },
  });
  assertEquals(v.cost_usd, 1);
  assertEquals(v.judge_cost_usd, 0);
  assertEquals(v.cases_version, "abc");
  assertEquals(v.config, { rag: "off" });
});

Deno.test("suiteCasesVersion - is a stable short hash, distinct per suite", async () => {
  const a = await suiteCasesVersion("routing");
  assertEquals(a, await suiteCasesVersion("routing"));
  assertEquals(a.length, 12);
  assertEquals(a === (await suiteCasesVersion("summarization")), false);
});

Deno.test("suiteOfCategory - maps each metric back to the suite that produces it", () => {
  assertEquals(suiteOfCategory("param-extraction"), "routing");
  assertEquals(suiteOfCategory("summarization"), "summarization");
  assertEquals(suiteOfCategory("nope"), undefined);
});
