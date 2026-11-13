import { join } from "@std/path";
import { loadReport } from "./metrics.ts";
import { buildRunReport, reportToHtml, reportToMarkdown, type RunReport } from "./report.ts";
import { formatCost } from "./pricing.ts";
import {
  LEVEL_THRESHOLDS,
  evalResultsDir,
  type MetricResult,
  type MetricStatus,
  type ModelProfile,
} from "./profile.ts";

export interface ProfileExport {
  profile: ModelProfile;
  status: Record<string, MetricStatus>;
  /** Full reports of the runs behind each metric's latest result. */
  runs: RunReport[];
}

/** Loads the run reports the profile's latest results came from (skipping
 *  any whose .jsonl is no longer on disk). */
export async function buildProfileExport(
  profile: ModelProfile,
  status: Record<string, MetricStatus>,
  resultsDir = evalResultsDir(),
): Promise<ProfileExport> {
  const runIds = [...new Set(Object.values(profile.latest).map((m) => m.runId).filter((id): id is string => !!id))];
  const runs: RunReport[] = [];
  for (const runId of runIds) {
    try {
      runs.push(buildRunReport(await loadReport(join(resultsDir, `${runId}.jsonl`))));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return { profile, status, runs };
}

const LEVEL_LABEL = { "very-good": "Very good", good: "Good", fair: "Fair", poor: "Poor" } as const;

function thresholdsLine(): string {
  const t = LEVEL_THRESHOLDS;
  return `Levels: very good ≥ ${t["very-good"] * 100}%, good ≥ ${t.good * 100}%, fair ≥ ${t.fair * 100}%, poor below.`;
}

function metricNotes(m: MetricResult, s: MetricStatus | undefined): string {
  const notes: string[] = [];
  if (m.casesUnjudged > 0) notes.push(`${m.casesUnjudged} unjudged`);
  if (m.interval) {
    notes.push(`95% range ${(m.interval.low * 100).toFixed(0)}–${(m.interval.high * 100).toFixed(0)}%`);
  }
  if (m.lowConfidence) notes.push("low confidence");
  if (s?.stale) notes.push(`stale: ${s.reasons.join("; ")}`);
  return notes.join(", ") || "-";
}

function evolution(history: MetricResult[]): string {
  return history.map((h) => `${(h.value * 100).toFixed(0)}%`).join(" → ");
}

export function profileExportToMarkdown(exp: ProfileExport): string {
  const { profile, status } = exp;
  const lines = [`# Model profile: ${profile.model}`, "", thresholdsLine(), ""];
  lines.push("| Metric | Value | Level | Cases | Notes | Judge | Rubric | Case set | Cost | Date | Evolution |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const m of Object.values(profile.latest)) {
    lines.push(
      `| ${m.category} | ${(m.value * 100).toFixed(0)}% | ${LEVEL_LABEL[m.level]} | ${m.casesGraded} | ` +
        `${metricNotes(m, status[m.category])} | ${m.judgeModel ?? "-"} | ${m.rubricVersion ?? "-"} | ` +
        `${m.casesVersion} | ${formatCost(m.costUsd)} | ${m.date.slice(0, 10)} | ${evolution(profile.history[m.category] ?? [m])} |`,
    );
  }
  lines.push("");
  for (const run of exp.runs) {
    lines.push("---", "", reportToMarkdown(run).replace(/^# /, "## "));
  }
  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function profileExportToHtml(exp: ProfileExport): string {
  const { profile, status } = exp;
  const rows = Object.values(profile.latest)
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.category)}</td><td>${(m.value * 100).toFixed(0)}%</td><td>${LEVEL_LABEL[m.level]}</td>` +
        `<td>${m.casesGraded}</td><td>${escapeHtml(metricNotes(m, status[m.category]))}</td>` +
        `<td>${escapeHtml(m.judgeModel ?? "-")}</td><td>${escapeHtml(m.rubricVersion ?? "-")}</td>` +
        `<td>${escapeHtml(m.casesVersion)}</td><td>${formatCost(m.costUsd)}</td><td>${m.date.slice(0, 10)}</td>` +
        `<td>${escapeHtml(evolution(profile.history[m.category] ?? [m]))}</td></tr>`,
    )
    .join("\n");

  // Each run report is a full page; embed just its body.
  const runSections = exp.runs
    .map((run) => {
      const html = reportToHtml(run);
      const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
      return `<hr>${body.replace("<h1>", "<h2>").replace("</h1>", "</h2>")}`;
    })
    .join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Model profile: ${escapeHtml(profile.model)}</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:1100px}table{border-collapse:collapse;width:100%;margin-bottom:1.5rem}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top;font-size:14px}th{background:#f3f3f3}details summary{cursor:pointer}.pass{color:#137333}.fail{color:#b3261e}.unjudged{color:#8a5a00}</style>
</head><body>
<h1>Model profile: ${escapeHtml(profile.model)}</h1>
<p>${escapeHtml(thresholdsLine())}</p>
<table>
<tr><th>Metric</th><th>Value</th><th>Level</th><th>Cases</th><th>Notes</th><th>Judge</th><th>Rubric</th><th>Case set</th><th>Cost</th><th>Date</th><th>Evolution</th></tr>
${rows}
</table>
${runSections}
</body></html>
`;
}
