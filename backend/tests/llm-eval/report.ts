import { summarizeByCategory, type CategorySummary, type EvalVerdict } from "./metrics.ts";
import { formatCost, sumCosts } from "./pricing.ts";

// ---------------------------------------------------------------------------
// Single run
// ---------------------------------------------------------------------------

export interface RunTotals {
  cases: number;
  graded: number;
  passed: number;
  unjudged: number;
  passRate: number;
  /** Average judge score over judge-scored cases; undefined if none were. */
  avgScore?: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** Executor cost; null when any case's model price is unknown. */
  costUsd: number | null;
  judgeCostUsd: number | null;
}

export interface RunHeader {
  runId: string;
  executorModel: string;
  /** Judges that actually graded cases (empty for an exact-match-only run). */
  judgeModels: string[];
  rubricVersions: string[];
  /** Case-set version per category, from casesVersion.ts. */
  casesVersions: Record<string, string>;
  config: Record<string, string>;
  totals: RunTotals;
}

export interface RunReport extends RunHeader {
  summaries: CategorySummary[];
  /** Every case, grouped by category in run order. */
  verdicts: EvalVerdict[];
  /** Cases the judge couldn't grade — listed apart, outside every average. */
  unjudgedCases: EvalVerdict[];
}

function unique<T>(values: (T | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => v !== undefined))];
}

export function computeTotals(verdicts: EvalVerdict[]): RunTotals {
  const graded = verdicts.filter((v) => v.judged_by !== "unjudged");
  const passed = graded.filter((v) => v.pass).length;
  const scored = graded.filter((v) => v.score !== undefined);
  return {
    cases: verdicts.length,
    graded: graded.length,
    passed,
    unjudged: verdicts.length - graded.length,
    passRate: graded.length > 0 ? passed / graded.length : 0,
    avgScore:
      scored.length > 0
        ? scored.reduce((sum, v) => sum + (v.score ?? 0), 0) / scored.length
        : undefined,
    inputTokens: verdicts.reduce((sum, v) => sum + v.input_tokens, 0),
    outputTokens: verdicts.reduce((sum, v) => sum + v.output_tokens, 0),
    durationMs: verdicts.reduce((sum, v) => sum + v.duration_ms, 0),
    costUsd: sumCosts(verdicts.map((v) => v.cost_usd)),
    judgeCostUsd: sumCosts(
      verdicts.filter((v) => v.judged_by !== "exact").map((v) => v.judge_cost_usd ?? 0),
    ),
  };
}

export function buildRunHeader(verdicts: EvalVerdict[]): RunHeader {
  const judged = verdicts.filter((v) => v.judged_by !== "exact");
  const casesVersions: Record<string, string> = {};
  for (const v of verdicts) {
    if (v.cases_version) casesVersions[v.category] = v.cases_version;
  }
  return {
    runId: verdicts[0].run_id,
    executorModel: verdicts[0].executor_model,
    judgeModels: unique(judged.map((v) => v.judge_model)),
    rubricVersions: unique(judged.map((v) => v.rubric_version)),
    casesVersions,
    config: verdicts[0].config ?? {},
    totals: computeTotals(verdicts),
  };
}

export function buildRunReport(verdicts: EvalVerdict[]): RunReport {
  if (verdicts.length === 0) {
    throw new Error("buildRunReport() called with an empty verdict list.");
  }
  const summaries = summarizeByCategory(verdicts);
  const order = summaries.map((s) => s.category);
  return {
    ...buildRunHeader(verdicts),
    summaries,
    verdicts: [...verdicts].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category)),
    unjudgedCases: verdicts.filter((v) => v.judged_by === "unjudged"),
  };
}

export function reportToJson(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}

// --- formatting helpers ----------------------------------------------------

const pct = (rate: number) => `${(rate * 100).toFixed(0)}%`;
const score = (s: number | undefined) => (s !== undefined ? s.toFixed(0) : "-");
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const tokens = (input: number, output: number) => `${input}in/${output}out`;

function configLabel(config: Record<string, string>): string {
  const entries = Object.entries(config);
  return entries.length > 0 ? entries.map(([k, v]) => `${k}=${v}`).join(", ") : "(none)";
}

function statusLabel(v: EvalVerdict): string {
  if (v.judged_by === "unjudged") return "UNJUDGED";
  return v.pass ? "PASS" : "FAIL";
}

/** Keeps a table cell on one line. */
function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll(/\s*\n\s*/g, " ");
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function headerLines(h: RunHeader): string[] {
  const t = h.totals;
  return [
    `- Executor: ${h.executorModel}`,
    `- Judge: ${h.judgeModels.length > 0 ? h.judgeModels.join(", ") : "(none — exact-match only)"}`,
    `- Rubric version: ${h.rubricVersions.length > 0 ? h.rubricVersions.join(", ") : "-"}`,
    `- Configuration: ${configLabel(h.config)}`,
    `- Cases: ${t.cases} (${t.passed}/${t.graded} passed, ${pct(t.passRate)}${t.unjudged > 0 ? `, ${t.unjudged} unjudged` : ""})`,
    `- Avg judge score: ${score(t.avgScore)}`,
    `- Tokens: ${tokens(t.inputTokens, t.outputTokens)}`,
    `- Cost: ${formatCost(t.costUsd)} (judge: ${formatCost(t.judgeCostUsd)})`,
    `- Time: ${secs(t.durationMs)}`,
  ];
}

export function reportToMarkdown(report: RunReport): string {
  const lines: string[] = [`# Eval report: ${report.runId}`, "", ...headerLines(report), ""];

  lines.push("## By category", "");
  lines.push("| Category | Passed | Pass rate | Unjudged | Avg score | Tokens | Cost | Time |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const s of report.summaries) {
    lines.push(
      `| ${s.category} | ${s.passed}/${s.graded} | ${pct(s.passRate)} | ${s.unjudged} | ${score(s.avgScore)} | ` +
        `${tokens(s.totalInputTokens, s.totalOutputTokens)} | ${formatCost(s.totalCostUsd)} | ${secs(s.totalDurationMs)} |`,
    );
  }
  lines.push("");

  lines.push("## Cases", "");
  lines.push("| Case | Category | Result | Score | Tokens | Time | Judge justification / detail |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const v of report.verdicts.filter((v) => v.judged_by !== "unjudged")) {
    lines.push(
      `| ${cell(v.case_id)} | ${v.category} | ${statusLabel(v)} | ${score(v.score)} | ` +
        `${tokens(v.input_tokens, v.output_tokens)} | ${secs(v.duration_ms)} | ${cell(v.detail)} |`,
    );
  }
  lines.push("");

  if (report.unjudgedCases.length > 0) {
    lines.push("## Unjudged cases", "");
    lines.push("The judge failed or answered in an invalid format; these count as neither pass nor fail.", "");
    for (const v of report.unjudgedCases) lines.push(`- ${v.case_id}: ${cell(v.detail)}`);
    lines.push("");
  }

  return lines.join("\n");
}

const HTML_STYLE = `body{font-family:system-ui,sans-serif;margin:2rem;max-width:1100px;color:#1a1a1a}
table{border-collapse:collapse;margin:0.5rem 0 1.5rem;width:100%}
th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top;font-size:14px}
th{background:#f3f3f3}.pass{color:#137333}.fail{color:#b3261e}.unjudged{color:#8a5a00}
.warn{background:#fff4e5;border:1px solid #f0c36d;padding:8px 12px;border-radius:6px}
details summary{cursor:pointer}ul.meta{list-style:none;padding:0}`;

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${HTML_STYLE}</style></head>
<body>
${body}
</body></html>
`;
}

function statusHtml(v: EvalVerdict | undefined): string {
  if (!v) return "-";
  const label = statusLabel(v);
  return `<span class="${label.toLowerCase()}">${label}</span>`;
}

export function reportToHtml(report: RunReport): string {
  const meta = headerLines(report)
    .map((l) => `<li>${escapeHtml(l.slice(2))}</li>`)
    .join("");

  const categoryRows = report.summaries
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.category)}</td><td>${s.passed}/${s.graded}</td><td>${pct(s.passRate)}</td>` +
        `<td>${s.unjudged}</td><td>${score(s.avgScore)}</td>` +
        `<td>${tokens(s.totalInputTokens, s.totalOutputTokens)}</td><td>${formatCost(s.totalCostUsd)}</td>` +
        `<td>${secs(s.totalDurationMs)}</td></tr>`,
    )
    .join("\n");

  const caseRows = report.verdicts
    .filter((v) => v.judged_by !== "unjudged")
    .map(
      (v) =>
        `<tr><td>${escapeHtml(v.case_id)}</td><td>${escapeHtml(v.category)}</td><td>${statusHtml(v)}</td>` +
        `<td>${score(v.score)}</td><td>${tokens(v.input_tokens, v.output_tokens)}</td><td>${secs(v.duration_ms)}</td>` +
        `<td><details><summary>${v.judged_by === "llm-judge" ? "Judge justification" : "Detail"}</summary>` +
        `${escapeHtml(v.detail)}</details></td></tr>`,
    )
    .join("\n");

  const unjudged =
    report.unjudgedCases.length > 0
      ? `<h2>Unjudged cases</h2><p class="warn">The judge failed or answered in an invalid format; these count as neither pass nor fail.</p><ul>${report.unjudgedCases
          .map((v) => `<li>${escapeHtml(v.case_id)}: ${escapeHtml(v.detail)}</li>`)
          .join("")}</ul>`
      : "";

  return htmlPage(
    `Eval report: ${report.runId}`,
    `<h1>Eval report: ${escapeHtml(report.runId)}</h1>
<ul class="meta">${meta}</ul>
<h2>By category</h2>
<table>
<tr><th>Category</th><th>Passed</th><th>Pass rate</th><th>Unjudged</th><th>Avg score</th><th>Tokens</th><th>Cost</th><th>Time</th></tr>
${categoryRows}
</table>
<h2>Cases</h2>
<table>
<tr><th>Case</th><th>Category</th><th>Result</th><th>Score</th><th>Tokens</th><th>Time</th><th>Justification</th></tr>
${caseRows}
</table>
${unjudged}`,
  );
}

// ---------------------------------------------------------------------------
// Comparison of 2+ runs
// ---------------------------------------------------------------------------

export interface CaseChange {
  caseId: string;
  category: string;
  /** Labels of the two runs being diffed, in comparison order. */
  fromRun: string;
  toRun: string;
  fromPass?: boolean;
  toPass?: boolean;
  fromScore?: number;
  toScore?: number;
  kind: "newly-passing" | "newly-failing" | "score-changed";
}

/** Signed change of a metric from the first run to this one (undefined for the first run or when unknown). */
export interface MetricDeltas {
  passRate?: number;
  avgScore?: number;
  tokens?: number;
  costUsd?: number;
  durationMs?: number;
}

export interface CategoryComparison {
  category: string;
  /** One summary per run, in input order; undefined if the run has no verdicts in this category. */
  perRun: (CategorySummary | undefined)[];
  /** Change vs the first run that has this category, per run. */
  deltas: (MetricDeltas | undefined)[];
  /** False when the runs used different case sets for this category. */
  comparable: boolean;
  notComparableReason?: string;
}

export interface CaseComparison {
  caseId: string;
  category: string;
  /** Per run: the verdict for this case, or undefined if the run lacks it. */
  perRun: (Pick<EvalVerdict, "pass" | "score" | "judged_by" | "detail"> | undefined)[];
  /** Last minus first score among runs that judge-scored this case. */
  scoreDelta?: number;
}

export interface RunComparison {
  runIds: string[];
  runs: RunHeader[];
  /** What sets the compared runs apart (model, judge, configuration...). */
  differences: string[];
  /** Why scores may not be apples-to-apples (different judges, rubric
   *  versions, missing cases...). */
  warnings: string[];
  categories: CategoryComparison[];
  /** Every case in any run, side by side. */
  cases: CaseComparison[];
  /** Only cases present in at least two of the compared runs whose pass/fail
   *  or score changed between the first and last run that has them. */
  changedCases: CaseChange[];
  /** Cases the judge couldn't grade, per run — kept out of every average. */
  unjudgedCases: { runId: string; caseId: string; detail: string }[];
}

const SCORE_CHANGE_THRESHOLD = 10;

/**
 * Compares 2+ runs (already-loaded verdict lists) side by side: totals and
 * per-category metrics with their change vs the first run, every case's
 * result per run, and which cases improved or worsened.
 */
export function compareRuns(runs: EvalVerdict[][]): RunComparison {
  if (runs.length < 2) {
    throw new Error("compareRuns() requires at least 2 runs.");
  }
  if (runs.some((r) => r.length === 0)) {
    throw new Error("compareRuns() received an empty run.");
  }

  const headers = runs.map(buildRunHeader);
  const runIds = headers.map((h) => h.runId);

  const allCategories = new Set<string>();
  const summariesPerRun = runs.map((r) => {
    const map = new Map(summarizeByCategory(r).map((s) => [s.category, s]));
    for (const category of map.keys()) allCategories.add(category);
    return map;
  });

  const categories: CategoryComparison[] = [...allCategories].map((category) => {
    const perRun = summariesPerRun.map((m) => m.get(category));
    const versions = headers.map((h) => h.casesVersions[category]);
    const known = unique(versions.filter((_, i) => perRun[i] !== undefined));
    const comparable = known.length <= 1;
    return {
      category,
      perRun,
      deltas: categoryDeltas(perRun),
      comparable,
      notComparableReason: comparable
        ? undefined
        : `runs used different case sets for '${category}' (${known.join(" vs ")})`,
    };
  });

  return {
    runIds,
    runs: headers,
    differences: buildDifferences(headers),
    warnings: buildWarnings(runs, headers, categories),
    categories,
    cases: buildCaseComparisons(runs),
    changedCases: findChangedCases(runs, runIds),
    unjudgedCases: runs.flatMap((r) =>
      r
        .filter((v) => v.judged_by === "unjudged")
        .map((v) => ({ runId: v.run_id, caseId: v.case_id, detail: v.detail })),
    ),
  };
}

function categoryDeltas(perRun: (CategorySummary | undefined)[]): (MetricDeltas | undefined)[] {
  const baseIdx = perRun.findIndex((s) => s !== undefined);
  const base = perRun[baseIdx];
  return perRun.map((s, i) => {
    if (!s || !base || i === baseIdx) return undefined;
    return {
      passRate: s.passRate - base.passRate,
      avgScore:
        s.avgScore !== undefined && base.avgScore !== undefined
          ? s.avgScore - base.avgScore
          : undefined,
      tokens:
        s.totalInputTokens + s.totalOutputTokens - (base.totalInputTokens + base.totalOutputTokens),
      costUsd:
        s.totalCostUsd !== null && base.totalCostUsd !== null
          ? s.totalCostUsd - base.totalCostUsd
          : undefined,
      durationMs: s.totalDurationMs - base.totalDurationMs,
    };
  });
}

function buildDifferences(headers: RunHeader[]): string[] {
  const differences: string[] = [];
  const describe = (label: string, values: string[]) => {
    if (new Set(values).size > 1) differences.push(`${label}: ${values.join(" vs ")}`);
  };
  describe("Model", headers.map((h) => h.executorModel));
  describe("Judge", headers.map((h) => h.judgeModels.join(", ") || "(none)"));

  const configKeys = unique(headers.flatMap((h) => Object.keys(h.config)));
  for (const key of configKeys) {
    describe(`Config '${key}'`, headers.map((h) => h.config[key] ?? "(unset)"));
  }
  return differences;
}

function buildWarnings(
  runs: EvalVerdict[][],
  headers: RunHeader[],
  categories: CategoryComparison[],
): string[] {
  const warnings: string[] = [];

  const judgeModels = unique(headers.flatMap((h) => h.judgeModels));
  if (judgeModels.length > 1) {
    warnings.push(`Runs were graded by different judge models: ${judgeModels.join(", ")} — score differences may reflect judge variance, not executor quality.`);
  }

  const rubricVersions = unique(headers.flatMap((h) => h.rubricVersions));
  if (rubricVersions.length > 1) {
    warnings.push(`Runs used different rubric versions: ${rubricVersions.join(", ")} — scores may not be directly comparable.`);
  }

  for (const c of categories.filter((c) => !c.comparable)) {
    warnings.push(`Not comparable: ${c.notComparableReason}.`);
  }

  const caseIdSets = runs.map((r) => new Set(r.map((v) => v.case_id)));
  const union = new Set(caseIdSets.flatMap((s) => [...s]));
  for (let i = 0; i < caseIdSets.length; i++) {
    const missing = [...union].filter((id) => !caseIdSets[i].has(id));
    if (missing.length > 0) {
      warnings.push(`Run '${headers[i].runId}' is missing ${missing.length} case(s) present in other runs — comparison for those cases is skipped.`);
    }
  }

  return warnings;
}

function buildCaseComparisons(runs: EvalVerdict[][]): CaseComparison[] {
  const byCase = new Map<string, CaseComparison>();
  runs.forEach((run, i) => {
    for (const v of run) {
      const entry = byCase.get(v.case_id) ?? {
        caseId: v.case_id,
        category: v.category,
        perRun: new Array(runs.length).fill(undefined),
      };
      entry.perRun[i] = { pass: v.pass, score: v.score, judged_by: v.judged_by, detail: v.detail };
      byCase.set(v.case_id, entry);
    }
  });
  for (const entry of byCase.values()) {
    const scores = entry.perRun
      .filter((r) => r?.judged_by === "llm-judge" && r.score !== undefined)
      .map((r) => r!.score!);
    if (scores.length >= 2) entry.scoreDelta = scores[scores.length - 1] - scores[0];
  }
  return [...byCase.values()];
}

function findChangedCases(runs: EvalVerdict[][], runIds: string[]): CaseChange[] {
  const byCaseId = new Map<string, (EvalVerdict | undefined)[]>();
  for (let i = 0; i < runs.length; i++) {
    for (const v of runs[i]) {
      const slots = byCaseId.get(v.case_id) ?? new Array(runs.length).fill(undefined);
      slots[i] = v;
      byCaseId.set(v.case_id, slots);
    }
  }

  const changes: CaseChange[] = [];
  for (const [caseId, slots] of byCaseId) {
    const present = slots.filter((v): v is EvalVerdict => v !== undefined);
    if (present.length < 2) continue;

    const first = present[0];
    const last = present[present.length - 1];
    const firstIdx = slots.indexOf(first);
    const lastIdx = slots.lastIndexOf(last);

    if (first.judged_by === "unjudged" || last.judged_by === "unjudged") continue;

    const change = {
      caseId,
      category: last.category,
      fromRun: runIds[firstIdx],
      toRun: runIds[lastIdx],
      fromPass: first.pass,
      toPass: last.pass,
      fromScore: first.score,
      toScore: last.score,
    };

    if (first.pass !== last.pass) {
      changes.push({ ...change, kind: last.pass ? "newly-passing" : "newly-failing" });
    } else if (
      first.score !== undefined &&
      last.score !== undefined &&
      Math.abs(last.score - first.score) >= SCORE_CHANGE_THRESHOLD
    ) {
      changes.push({ ...change, kind: "score-changed" });
    }
  }

  return changes;
}

export function comparisonToJson(comparison: RunComparison): string {
  return JSON.stringify(comparison, null, 2);
}

// --- comparison formatting -------------------------------------------------

const signed = (n: number, digits = 0) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

/** "80% (+10pp)" style cell: a run's value followed by its change vs the first run. */
function withDelta(value: string, delta: string | undefined): string {
  return delta ? `${value} (${delta})` : value;
}

function categoryCells(c: CategoryComparison, i: number) {
  const s = c.perRun[i];
  const d = c.deltas[i];
  if (!s) return { passRate: "-", score: "-", tokens: "-", cost: "-", time: "-" };
  return {
    passRate: withDelta(pct(s.passRate), d ? `${signed(d.passRate! * 100)}pp` : undefined),
    score: withDelta(score(s.avgScore), d?.avgScore !== undefined ? signed(d.avgScore) : undefined),
    tokens: withDelta(
      String(s.totalInputTokens + s.totalOutputTokens),
      d?.tokens !== undefined ? signed(d.tokens) : undefined,
    ),
    cost: withDelta(
      formatCost(s.totalCostUsd),
      d?.costUsd !== undefined ? `${d.costUsd >= 0 ? "+" : "-"}${formatCost(Math.abs(d.costUsd))}` : undefined,
    ),
    time: withDelta(secs(s.totalDurationMs), d?.durationMs !== undefined ? `${signed(d.durationMs / 1000, 1)}s` : undefined),
  };
}

function caseResultLabel(r: CaseComparison["perRun"][number]): string {
  if (!r) return "-";
  if (r.judged_by === "unjudged") return "UNJUDGED";
  const label = r.pass ? "PASS" : "FAIL";
  return r.score !== undefined ? `${label} (${r.score})` : label;
}

function changeLabel(c: CaseChange): string {
  const from = c.fromScore !== undefined ? `${c.fromPass ? "PASS" : "FAIL"} (${c.fromScore})` : c.fromPass ? "PASS" : "FAIL";
  const to = c.toScore !== undefined ? `${c.toPass ? "PASS" : "FAIL"} (${c.toScore})` : c.toPass ? "PASS" : "FAIL";
  return `${from} → ${to}`;
}

const CHANGE_TITLE: Record<CaseChange["kind"], string> = {
  "newly-passing": "improved (now passes)",
  "newly-failing": "worsened (now fails)",
  "score-changed": "score changed",
};

export function comparisonToMarkdown(comparison: RunComparison): string {
  const { runIds } = comparison;
  const lines: string[] = [`# Eval comparison: ${runIds.join(" vs ")}`, ""];

  lines.push("## Runs", "");
  lines.push("| Run | Model | Judge | Config | Passed | Avg score | Tokens | Cost | Time |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const h of comparison.runs) {
    const t = h.totals;
    lines.push(
      `| ${h.runId} | ${h.executorModel} | ${h.judgeModels.join(", ") || "-"} | ${configLabel(h.config)} | ` +
        `${t.passed}/${t.graded} (${pct(t.passRate)}) | ${score(t.avgScore)} | ${t.inputTokens + t.outputTokens} | ` +
        `${formatCost(t.costUsd)} | ${secs(t.durationMs)} |`,
    );
  }
  lines.push("");

  lines.push("## What differs between the runs", "");
  if (comparison.differences.length === 0) lines.push("Nothing recorded differs (same model, judge and configuration).");
  for (const d of comparison.differences) lines.push(`- ${d}`);
  lines.push("");

  if (comparison.warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const w of comparison.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Summary by category", "", "Values per run; in parentheses, the change vs the first run.", "");
  for (const [label, key] of [
    ["Pass rate", "passRate"],
    ["Avg judge score", "score"],
    ["Tokens", "tokens"],
    ["Cost", "cost"],
    ["Time", "time"],
  ] as const) {
    lines.push(`### ${label}`, "");
    lines.push(`| Category | ${runIds.join(" | ")} |`);
    lines.push(`|---|${runIds.map(() => "---").join("|")}|`);
    for (const c of comparison.categories) {
      const name = c.comparable ? c.category : `${c.category} ⚠ not comparable`;
      lines.push(`| ${name} | ${runIds.map((_, i) => categoryCells(c, i)[key]).join(" | ")} |`);
    }
    lines.push("");
  }

  lines.push("## Changed cases", "");
  if (comparison.changedCases.length === 0) {
    lines.push("No case changed pass/fail status or score significantly between the compared runs.");
  } else {
    lines.push("| Case | Category | Change | From → To |");
    lines.push("|---|---|---|---|");
    for (const c of comparison.changedCases) {
      lines.push(`| ${cell(c.caseId)} | ${c.category} | ${CHANGE_TITLE[c.kind]} | ${changeLabel(c)} |`);
    }
  }
  lines.push("");

  lines.push("## All cases", "");
  lines.push(`| Case | Category | ${runIds.join(" | ")} | Score Δ |`);
  lines.push(`|---|---|${runIds.map(() => "---").join("|")}|---|`);
  for (const c of comparison.cases) {
    lines.push(
      `| ${cell(c.caseId)} | ${c.category} | ${c.perRun.map(caseResultLabel).join(" | ")} | ` +
        `${c.scoreDelta !== undefined ? signed(c.scoreDelta) : "-"} |`,
    );
  }
  lines.push("");

  if (comparison.unjudgedCases.length > 0) {
    lines.push("## Unjudged cases", "", "Not counted as passed or failed in any average.", "");
    for (const u of comparison.unjudgedCases) lines.push(`- ${u.runId} · ${u.caseId}: ${cell(u.detail)}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function comparisonToHtml(comparison: RunComparison): string {
  const { runIds } = comparison;
  const runHeaders = runIds.map((id) => `<th>${escapeHtml(id)}</th>`).join("");

  const runRows = comparison.runs
    .map((h) => {
      const t = h.totals;
      return `<tr><td>${escapeHtml(h.runId)}</td><td>${escapeHtml(h.executorModel)}</td>` +
        `<td>${escapeHtml(h.judgeModels.join(", ") || "-")}</td><td>${escapeHtml(configLabel(h.config))}</td>` +
        `<td>${t.passed}/${t.graded} (${pct(t.passRate)})</td><td>${score(t.avgScore)}</td>` +
        `<td>${t.inputTokens + t.outputTokens}</td><td>${formatCost(t.costUsd)}</td><td>${secs(t.durationMs)}</td></tr>`;
    })
    .join("\n");

  const differences =
    comparison.differences.length > 0
      ? `<ul>${comparison.differences.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>`
      : "<p>Nothing recorded differs (same model, judge and configuration).</p>";

  const warningsHtml =
    comparison.warnings.length > 0
      ? `<h2>Warnings</h2><div class="warn"><ul>${comparison.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`
      : "";

  const categoryRows = comparison.categories
    .map((c) => {
      const name = escapeHtml(c.category) + (c.comparable ? "" : ` <span class="unjudged">⚠ not comparable</span>`);
      const cells = runIds
        .map((_, i) => {
          const v = categoryCells(c, i);
          return `<td>${v.passRate}<br>score ${v.score}<br>${v.tokens} tok · ${v.cost} · ${v.time}</td>`;
        })
        .join("");
      return `<tr><td>${name}</td>${cells}</tr>`;
    })
    .join("\n");

  const changedRows =
    comparison.changedCases.length > 0
      ? comparison.changedCases
          .map(
            (c) =>
              `<tr><td>${escapeHtml(c.caseId)}</td><td>${escapeHtml(c.category)}</td>` +
              `<td class="${c.kind === "newly-failing" ? "fail" : "pass"}">${CHANGE_TITLE[c.kind]}</td><td>${changeLabel(c)}</td></tr>`,
          )
          .join("\n")
      : `<tr><td colspan="4">No case changed pass/fail status or score significantly.</td></tr>`;

  const caseRows = comparison.cases
    .map((c) => {
      const cells = c.perRun
        .map((r) =>
          r
            ? `<td><details><summary>${escapeHtml(caseResultLabel(r))}</summary>${escapeHtml(r.detail)}</details></td>`
            : "<td>-</td>",
        )
        .join("");
      return `<tr><td>${escapeHtml(c.caseId)}</td><td>${escapeHtml(c.category)}</td>${cells}` +
        `<td>${c.scoreDelta !== undefined ? signed(c.scoreDelta) : "-"}</td></tr>`;
    })
    .join("\n");

  const unjudged =
    comparison.unjudgedCases.length > 0
      ? `<h2>Unjudged cases</h2><p>Not counted as passed or failed in any average.</p><ul>${comparison.unjudgedCases
          .map((u) => `<li>${escapeHtml(u.runId)} · ${escapeHtml(u.caseId)}: ${escapeHtml(u.detail)}</li>`)
          .join("")}</ul>`
      : "";

  return htmlPage(
    "Eval comparison",
    `<h1>Eval comparison: ${escapeHtml(runIds.join(" vs "))}</h1>
<h2>Runs</h2>
<table>
<tr><th>Run</th><th>Model</th><th>Judge</th><th>Config</th><th>Passed</th><th>Avg score</th><th>Tokens</th><th>Cost</th><th>Time</th></tr>
${runRows}
</table>
<h2>What differs between the runs</h2>
${differences}
${warningsHtml}
<h2>Summary by category</h2>
<p>Values per run; in parentheses, the change vs the first run.</p>
<table>
<tr><th>Category</th>${runHeaders}</tr>
${categoryRows}
</table>
<h2>Changed cases</h2>
<table>
<tr><th>Case</th><th>Category</th><th>Change</th><th>From → To</th></tr>
${changedRows}
</table>
<h2>All cases</h2>
<p>Open a result to read the judge's justification.</p>
<table>
<tr><th>Case</th><th>Category</th>${runHeaders}<th>Score Δ</th></tr>
${caseRows}
</table>
${unjudged}`,
  );
}
