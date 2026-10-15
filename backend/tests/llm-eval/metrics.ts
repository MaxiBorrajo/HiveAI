import { join } from "@std/path";
import type { ModelProvider } from "../../core/ai/providers/types.ts";

export type EvalVerdictCategory =
  | "routing"
  | "abstention"
  | "param-extraction"
  | "multi-turn"
  | "generation"
  | "execution";

export interface EvalVerdict {
  case_id: string;
  category: EvalVerdictCategory;
  executor_model: string;
  judge_model: string;
  provider: ModelProvider;
  pass: boolean;
  judged_by: "exact" | "llm-judge";
  detail: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  run_id: string;
}

export const RESULTS_DIR = join(import.meta.dirname!, "results");

export function makeRunId(executorLabel: string): string {
  const date = new Date().toISOString().replace(/[:.]/g, "-");
  return `${date}-${executorLabel}`;
}

export async function writeReport(verdicts: EvalVerdict[]): Promise<string> {
  if (verdicts.length === 0) {
    throw new Error("writeReport() called with an empty verdict list.");
  }
  await Deno.mkdir(RESULTS_DIR, { recursive: true });
  const runId = verdicts[0].run_id;
  const path = join(RESULTS_DIR, `${runId}.jsonl`);
  const lines = verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n";
  await Deno.writeTextFile(path, lines);
  printSummary(verdicts);
  return path;
}

interface CategorySummary {
  category: string;
  total: number;
  passed: number;
  passRate: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
}

export function summarizeByCategory(verdicts: EvalVerdict[]): CategorySummary[] {
  const byCategory = new Map<string, EvalVerdict[]>();
  for (const v of verdicts) {
    const list = byCategory.get(v.category) ?? [];
    list.push(v);
    byCategory.set(v.category, list);
  }

  return [...byCategory.entries()].map(([category, list]) => {
    const total = list.length;
    const passed = list.filter((v) => v.pass).length;
    const avg = (f: (v: EvalVerdict) => number) =>
      list.reduce((sum, v) => sum + f(v), 0) / total;
    return {
      category,
      total,
      passed,
      passRate: passed / total,
      avgDurationMs: Math.round(avg((v) => v.duration_ms)),
      avgInputTokens: Math.round(avg((v) => v.input_tokens)),
      avgOutputTokens: Math.round(avg((v) => v.output_tokens)),
    };
  });
}

function printSummary(verdicts: EvalVerdict[]): void {
  console.log("\n--- Summary by category ---");
  for (const s of summarizeByCategory(verdicts)) {
    console.log(
      `${s.category}: ${s.passed}/${s.total} (${(s.passRate * 100).toFixed(0)}%) ` +
        `— avg ${s.avgDurationMs}ms, ${s.avgInputTokens}in/${s.avgOutputTokens}out tokens`,
    );
  }
  const total = verdicts.length;
  const passed = verdicts.filter((v) => v.pass).length;
  console.log(`\nTotal: ${passed}/${total} (${((passed / total) * 100).toFixed(0)}%)`);
}

export async function loadReport(path: string): Promise<EvalVerdict[]> {
  const text = await Deno.readTextFile(path);
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvalVerdict);
}
