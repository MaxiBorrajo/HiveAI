import { assert, assertEquals } from "@std/assert";
import { anyOf, evalCases, type EvalCase } from "../../../tests/llm-eval/cases.ts";
import { judgedEvalCases } from "../../../tests/llm-eval/judgedCases.ts";
import { generatorEvalCases } from "../../../tests/llm-eval/generatorCases.ts";
import { buildExecutionCases } from "../../../tests/llm-eval/executionCases.ts";
import { LOW_CONFIDENCE_MIN_CASES } from "../../../tests/llm-eval/profile.ts";
import { dryRun, gradeCall } from "../../../tests/llm-eval/runRouting.ts";
import ExcelWritePlugin from "../../../plugins/excel-write/index.ts";

const base = { inputTokens: 0, outputTokens: 0, durationMs: 0 };

function counterCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    name: "counter",
    category: "param-extraction",
    query: "increment my pushups counter by 20",
    queryEs: "sumale 20 al contador de flexiones",
    activePlugins: ["counter"],
    expectedTool: "counter",
    expectedParams: { name: "pushups", amount: 20 },
    expectedParamsEs: { name: "flexiones", amount: 20 },
    ...overrides,
  };
}

Deno.test("gradeCall - the Spanish run is graded against the Spanish params", () => {
  const call = { name: "counter", args: { name: "flexiones", amount: 20 } };

  assertEquals(gradeCall(counterCase(), call, base, "es").pass, true);
  assertEquals(gradeCall(counterCase(), call, base, "en").pass, false);
});

Deno.test("gradeCall - without Spanish params, both languages use the same ones", () => {
  const testCase = counterCase({ expectedParamsEs: undefined, expectedParams: { name: "yoga" } });

  assertEquals(gradeCall(testCase, { name: "counter", args: { name: "yoga" } }, base, "es").pass, true);
});

Deno.test("gradeCall - casing and surrounding spaces do not fail a param", () => {
  const call = { name: "counter", args: { name: "  Pushups ", amount: 20 } };

  assertEquals(gradeCall(counterCase(), call, base, "en").pass, true);
});

Deno.test("gradeCall - any of several equivalent values passes, others do not", () => {
  const testCase = counterCase({
    expectedTool: "current_datetime",
    expectedParams: { timezone: anyOf("America/Argentina/Buenos_Aires", "America/Buenos_Aires") },
  });
  const grade = (timezone: string) =>
    gradeCall(testCase, { name: "current_datetime", args: { timezone } }, base);

  assertEquals(grade("America/Buenos_Aires").pass, true);
  assertEquals(grade("America/Argentina/Buenos_Aires").pass, true);
  const wrong = grade("America/Montevideo");
  assertEquals(wrong.pass, false);
  assert(wrong.detail.includes("one of"));
});

Deno.test("gradeCall - a different value or type still fails", () => {
  assertEquals(gradeCall(counterCase(), { name: "counter", args: { name: "pushups", amount: 2 } }, base).pass, false);
  assertEquals(gradeCall(counterCase(), { name: "counter", args: { name: "pushups", amount: "20" } }, base).pass, false);
});

Deno.test("dryRun - a plugin picked during a routing eval never touches the disk", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/sales.xlsx`;

  const output = await dryRun(new ExcelWritePlugin()).process({
    path,
    sheets: [{ name: "Q1", rows: [{ month: "jan", total: 100 }] }],
  });

  assert(output.includes("not actually executed"));
  assertEquals(await Deno.stat(path).then(() => true, () => false), false);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("every metric has enough cases to be trusted", () => {
  const byCategory = new Map<string, number>();
  for (const c of evalCases) byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1);
  byCategory.set("summarization", judgedEvalCases.length);
  byCategory.set("generation", generatorEvalCases.length);
  byCategory.set("execution", buildExecutionCases("model", "ollama").length);

  for (const [category, count] of byCategory) {
    assert(count >= LOW_CONFIDENCE_MIN_CASES, `${category} has ${count} cases, needs ${LOW_CONFIDENCE_MIN_CASES}`);
  }
});

Deno.test("every case has a Spanish version and a unique name", () => {
  const names = [...evalCases, ...judgedEvalCases].map((c) => c.name);
  assertEquals(new Set(names).size, names.length);
  for (const c of [...evalCases, ...judgedEvalCases]) assert(c.queryEs, `'${c.name}' has no Spanish query`);
  for (const c of evalCases) {
    if (c.priorTurns) assertEquals(c.priorTurnsEs?.length, c.priorTurns.length, `'${c.name}' Spanish turns`);
  }
});
