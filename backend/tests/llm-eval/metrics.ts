import { join } from "@std/path";
import type { ModelProvider } from "../../core/ai/providers/types.ts";
import { costUsd, sumCosts } from "./pricing.ts";

export type EvalVerdictCategory =
  | "routing"
  | "abstention"
  | "param-extraction"
  | "multi-turn"
  | "file-creation"
  | "generation"
  | "execution"
  | "summarization";

export type EvalLang = "en" | "es";

export interface EvalVerdict {
  case_id: string;
  category: EvalVerdictCategory;
  executor_model: string;
  judge_model: string;
  provider: ModelProvider;
  pass: boolean;
  /**
   * "exact": matched/compared deterministically (expected tool, params,
   * graph structure, etc.) — no LLM judge involved, judge_model mirrors
   * executor_model and should be ignored.
   * "llm-judge": judge_model actually graded the output; `score` and
   * `rubric_version` are set.
   * "unjudged": the judge was invoked but its response couldn't be parsed —
   * this case counts as neither pass nor fail in aggregates.
   */
  judged_by: "exact" | "llm-judge" | "unjudged";
  /** 0-100, only set when judged_by === "llm-judge". */
  score?: number;
  /** Identifies which version of the case's rubric/reference was used, so
   *  runs across rubric edits aren't silently treated as comparable. */
  rubric_version?: string;
  /** For llm-judge verdicts this is the judge's justification; otherwise
   *  a short description of what matched or didn't. */
  detail: string;
  /** Tokens/time spent by the executor (the model being evaluated) only. */
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  /** Tokens/time spent by the judge grading this case, kept apart so the
   *  evaluated model's cost isn't inflated by the grading. */
  judge_input_tokens?: number;
  judge_output_tokens?: number;
  judge_duration_ms?: number;
  /** USD for the executor's tokens; null when the model's price is unknown
   *  (see pricing.ts). Local models are 0. */
  cost_usd?: number | null;
  judge_cost_usd?: number | null;
  /** Content hash of the suite's case set (casesVersion.ts) — runs on
   *  different case sets are flagged as not comparable. */
  cases_version?: string;
  /** Free-form labels describing how the run was configured (e.g.
   *  rag=on, token-opt=off), passed with --config, shown when comparing. */
  config?: Record<string, string>;
  run_id: string;
}

export const RESULTS_DIR = join(import.meta.dirname!, "results");

export function makeRunId(executorLabel: string): string {
  const date = new Date().toISOString().replace(/[:.]/g, "-");
  return `${date}-${executorLabel}`;
}

export async function writeReport(
  verdicts: EvalVerdict[],
  dir: string = RESULTS_DIR,
): Promise<string> {
  if (verdicts.length === 0) {
    throw new Error("writeReport() called with an empty verdict list.");
  }
  await Deno.mkdir(dir, { recursive: true });
  const runId = verdicts[0].run_id;
  const path = join(dir, `${runId}.jsonl`);
  const lines = verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n";
  await Deno.writeTextFile(path, lines);
  printSummary(verdicts);
  return path;
}

export interface CategorySummary {
  category: string;
  /** All verdicts in this category, including unjudged ones. */
  total: number;
  /** Verdicts that counted toward passRate (total minus unjudged). */
  graded: number;
  passed: number;
  /** Fraction of `passed` over `graded` — unjudged cases are excluded
   *  entirely, they count as neither a pass nor a fail. */
  passRate: number;
  unjudged: number;
  /** Average llm-judge score (0-100) across graded cases that have one;
   *  undefined if no case in this category was judge-scored. */
  avgScore?: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  /** Executor totals across every verdict in the category (graded or not). */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  /** Executor cost; null if any case's price is unknown. */
  totalCostUsd: number | null;
  /** What grading cost, kept apart from the executor's cost. */
  judgeCostUsd: number | null;
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
    const unjudgedList = list.filter((v) => v.judged_by === "unjudged");
    const gradedList = list.filter((v) => v.judged_by !== "unjudged");
    const graded = gradedList.length;
    const passed = gradedList.filter((v) => v.pass).length;
    const avg = (f: (v: EvalVerdict) => number) =>
      graded > 0 ? gradedList.reduce((sum, v) => sum + f(v), 0) / graded : 0;

    const scored = gradedList.filter((v) => v.score !== undefined);
    const avgScore =
      scored.length > 0
        ? scored.reduce((sum, v) => sum + (v.score ?? 0), 0) / scored.length
        : undefined;

    return {
      category,
      total,
      graded,
      passed,
      passRate: graded > 0 ? passed / graded : 0,
      unjudged: unjudgedList.length,
      avgScore,
      avgDurationMs: Math.round(avg((v) => v.duration_ms)),
      avgInputTokens: Math.round(avg((v) => v.input_tokens)),
      avgOutputTokens: Math.round(avg((v) => v.output_tokens)),
      totalInputTokens: list.reduce((sum, v) => sum + v.input_tokens, 0),
      totalOutputTokens: list.reduce((sum, v) => sum + v.output_tokens, 0),
      totalDurationMs: list.reduce((sum, v) => sum + v.duration_ms, 0),
      totalCostUsd: sumCosts(list.map((v) => v.cost_usd)),
      judgeCostUsd: sumCosts(
        list.filter((v) => v.judged_by !== "exact").map((v) => v.judge_cost_usd ?? 0),
      ),
    };
  });
}

function printSummary(verdicts: EvalVerdict[]): void {
  console.log("\n--- Summary by category ---");
  for (const s of summarizeByCategory(verdicts)) {
    const unjudgedNote = s.unjudged > 0 ? `, ${s.unjudged} unjudged` : "";
    const scoreNote = s.avgScore !== undefined ? `, avg score ${s.avgScore.toFixed(0)}` : "";
    console.log(
      `${s.category}: ${s.passed}/${s.graded} (${(s.passRate * 100).toFixed(0)}%)${unjudgedNote}${scoreNote} ` +
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
    .map((line) => backfillCost(JSON.parse(line) as EvalVerdict));
}

/** Runs recorded before costs were tracked: derive the executor's cost from
 *  its token counts so old and new runs can still be compared on cost. */
function backfillCost(v: EvalVerdict): EvalVerdict {
  if (v.cost_usd !== undefined) return v;
  const prefix = `${v.provider}:`;
  const model = v.executor_model.startsWith(prefix)
    ? v.executor_model.slice(prefix.length)
    : v.executor_model;
  return { ...v, cost_usd: costUsd({ provider: v.provider, model }, v.input_tokens, v.output_tokens) };
}
