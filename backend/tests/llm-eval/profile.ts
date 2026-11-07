import { join } from "@std/path";
import { homeDir } from "../../core/env.ts";
import type { ModelRef } from "../../core/ai/providers/types.ts";
import { summarizeByCategory, type EvalVerdict } from "./metrics.ts";
import { costUsd, sumCosts } from "./pricing.ts";
import { SUITE_CATEGORIES, suiteCaseCount, type SuiteName } from "./casesVersion.ts";

export type ProfileLevel = "very-good" | "good" | "fair" | "poor";

/**
 * Minimum value for each level. Values are a pass rate (0-1) for
 * exact-match metrics, or the average judge score (0-100) divided by 100 for
 * judge-graded ones. Tune them here; docs/llm-eval.md documents them.
 */
export const LEVEL_THRESHOLDS: Record<ProfileLevel, number> = {
  "very-good": 0.9,
  good: 0.7,
  fair: 0.5,
  poor: 0,
};

/** A metric is low-confidence when fewer than this many cases were graded. */
export const LOW_CONFIDENCE_MIN_CASES = 5;

export function classifyLevel(value: number): ProfileLevel {
  if (value >= LEVEL_THRESHOLDS["very-good"]) return "very-good";
  if (value >= LEVEL_THRESHOLDS.good) return "good";
  if (value >= LEVEL_THRESHOLDS.fair) return "fair";
  return "poor";
}

export interface MetricResult {
  category: string;
  /** passRate for exact-match categories, avgScore/100 when judge-scored. */
  value: number;
  level: ProfileLevel;
  casesGraded: number;
  casesUnjudged: number;
  lowConfidence: boolean;
  date: string;
  /** Version of this category's case set (casesVersion.ts). */
  casesVersion: string;
  judgeModel?: string;
  rubricVersion?: string;
  /** Exact model build evaluated (Ollama digest); undefined for cloud models,
   *  whose id already pins the version. */
  modelVersion?: string;
  /** Run this result came from — its .jsonl lives in the results dir. */
  runId?: string;
  /** Average executor tokens per case. */
  inputTokens: number;
  outputTokens: number;
  /** Average executor time per case. */
  durationMs: number;
  /** Total executor cost of this metric's cases; null if unknown. */
  costUsd?: number | null;
  /** Total cost of grading this metric's cases; null if unknown. */
  judgeCostUsd?: number | null;
}

export interface ModelProfile {
  model: string;
  /** Most recent result per category. */
  latest: Record<string, MetricResult>;
  /** Every result ever recorded per category, oldest first. */
  history: Record<string, MetricResult[]>;
}

export function emptyProfile(model: string): ModelProfile {
  return { model, latest: {}, history: {} };
}

export interface MetricExtras {
  modelVersion?: string;
  runId?: string;
}

/**
 * Turns a run's verdicts into one MetricResult per category. `casesVersion`
 * identifies the case set used — one string for every category, or one per
 * category — so a later change to the cases makes the profile stale.
 */
export function buildMetricResults(
  verdicts: EvalVerdict[],
  casesVersion: string | Record<string, string>,
  extras: MetricExtras = {},
): MetricResult[] {
  const date = new Date().toISOString();
  return summarizeByCategory(verdicts).map((s) => {
    const value = s.avgScore !== undefined ? s.avgScore / 100 : s.passRate;
    const categoryVerdicts = verdicts.filter((v) => v.category === s.category);
    const judged = categoryVerdicts.filter((v) => v.judged_by !== "exact");
    const judgeModels = new Set(judged.map((v) => v.judge_model));
    const rubricVersions = new Set(judged.map((v) => v.rubric_version).filter((v): v is string => v !== undefined));
    return {
      category: s.category,
      value,
      level: classifyLevel(value),
      casesGraded: s.graded,
      casesUnjudged: s.unjudged,
      lowConfidence: s.graded < LOW_CONFIDENCE_MIN_CASES,
      date,
      casesVersion: typeof casesVersion === "string" ? casesVersion : casesVersion[s.category] ?? "unknown",
      judgeModel: judgeModels.size === 1 ? [...judgeModels][0] : undefined,
      rubricVersion: rubricVersions.size === 1 ? [...rubricVersions][0] : undefined,
      modelVersion: extras.modelVersion,
      runId: extras.runId,
      inputTokens: s.avgInputTokens,
      outputTokens: s.avgOutputTokens,
      durationMs: s.avgDurationMs,
      costUsd: s.totalCostUsd,
      judgeCostUsd: judged.length > 0 ? s.judgeCostUsd : undefined,
    };
  });
}

/** Merges new metric results into a profile, appending to history and
 *  replacing `latest` per category. Never mutates the input profile. */
export function mergeIntoProfile(profile: ModelProfile, results: MetricResult[]): ModelProfile {
  const latest = { ...profile.latest };
  const history = { ...profile.history };
  for (const result of results) {
    latest[result.category] = result;
    history[result.category] = [...(history[result.category] ?? []), result];
  }
  return { ...profile, latest, history };
}

export interface StalenessCheck {
  stale: boolean;
  reasons: string[];
}

type VersionFacts = {
  casesVersion: string;
  judgeModel?: string;
  rubricVersion?: string;
  modelVersion?: string;
};

/** A metric is stale if the case set, model build, judge model, or rubric
 *  version used to produce it no longer matches the current ones. A fact
 *  that isn't known on either side is not treated as a change. */
export function checkStaleness(prior: VersionFacts, current: Partial<VersionFacts>): StalenessCheck {
  const reasons: string[] = [];
  if (current.casesVersion && prior.casesVersion !== current.casesVersion) {
    reasons.push(`case set changed (was '${prior.casesVersion}', now '${current.casesVersion}')`);
  }
  if (current.modelVersion && prior.modelVersion && prior.modelVersion !== current.modelVersion) {
    reasons.push(`model version changed (was '${prior.modelVersion.slice(0, 12)}', now '${current.modelVersion.slice(0, 12)}')`);
  }
  if (current.judgeModel && prior.judgeModel && prior.judgeModel !== current.judgeModel) {
    reasons.push(`judge model changed (was '${prior.judgeModel}', now '${current.judgeModel}')`);
  }
  if (current.rubricVersion && prior.rubricVersion && prior.rubricVersion !== current.rubricVersion) {
    reasons.push(`rubric version changed (was '${prior.rubricVersion}', now '${current.rubricVersion}')`);
  }
  return { stale: reasons.length > 0, reasons };
}

export interface MetricStatus extends StalenessCheck {
  /** The judge differs from the previous result's, so this point of the
   *  evolution isn't directly comparable with the one before it. */
  judgeChangedSincePrevious: boolean;
}

/**
 * Per category: whether the latest result is stale against the current case
 * set and model build, and whether its judge changed since the result before.
 */
export function profileStatus(
  profile: ModelProfile,
  current: { casesVersions: Record<string, string>; modelVersion?: string },
): Record<string, MetricStatus> {
  const status: Record<string, MetricStatus> = {};
  for (const [category, latest] of Object.entries(profile.latest)) {
    const history = profile.history[category] ?? [];
    const previous = history.length >= 2 ? history[history.length - 2] : undefined;
    const check = checkStaleness(latest, {
      casesVersion: current.casesVersions[category],
      modelVersion: current.modelVersion,
    });
    status[category] = {
      ...check,
      judgeChangedSincePrevious:
        !!previous?.judgeModel && !!latest.judgeModel && previous.judgeModel !== latest.judgeModel,
    };
  }
  return status;
}

// ---------------------------------------------------------------------------
// Cost estimate before a run
// ---------------------------------------------------------------------------

/** Typical executor tokens per case, averaged from past runs in results/ —
 *  used when the model has no history of its own for that suite yet. */
const DEFAULT_TOKENS_PER_CASE: Record<SuiteName, { input: number; output: number }> = {
  routing: { input: 4800, output: 250 },
  generation: { input: 10000, output: 2000 },
  execution: { input: 100, output: 110 },
  summarization: { input: 2300, output: 950 },
};
/** Typical tokens the judge spends grading one case. */
const JUDGE_TOKENS_PER_CASE = { input: 700, output: 60 };

export interface SuiteEstimate {
  suite: SuiteName;
  cases: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  judgeCostUsd: number | null;
  /** "history" when this model's own past results were used, else "defaults". */
  basedOn: "history" | "defaults";
}

export interface RunEstimate {
  suites: SuiteEstimate[];
  /** Executor + judge; null when a price is unknown. */
  totalCostUsd: number | null;
  /** True when any model involved is a paid cloud model. */
  requiresConfirmation: boolean;
}

export function estimateRun(
  executorRef: ModelRef,
  judgeRef: ModelRef | undefined,
  suites: SuiteName[],
  profile: ModelProfile,
  judgedSuites: SuiteName[],
): RunEstimate {
  const estimates = suites.map((suite): SuiteEstimate => {
    const cases = suiteCaseCount(suite);
    const own = SUITE_CATEGORIES[suite]
      .map((c) => profile.latest[c])
      .filter((m): m is MetricResult => m !== undefined);
    const perCase =
      own.length > 0
        ? {
          input: own.reduce((s, m) => s + m.inputTokens, 0) / own.length,
          output: own.reduce((s, m) => s + m.outputTokens, 0) / own.length,
        }
        : DEFAULT_TOKENS_PER_CASE[suite];
    const inputTokens = Math.round(perCase.input * cases);
    const outputTokens = Math.round(perCase.output * cases);
    const judged = judgedSuites.includes(suite) && judgeRef;
    return {
      suite,
      cases,
      inputTokens,
      outputTokens,
      costUsd: costUsd(executorRef, inputTokens, outputTokens),
      judgeCostUsd: judged
        ? costUsd(judgeRef, JUDGE_TOKENS_PER_CASE.input * cases, JUDGE_TOKENS_PER_CASE.output * cases)
        : 0,
      basedOn: own.length > 0 ? "history" : "defaults",
    };
  });
  const usesJudge = suites.some((s) => judgedSuites.includes(s));
  return {
    suites: estimates,
    totalCostUsd: sumCosts(estimates.flatMap((e) => [e.costUsd, e.judgeCostUsd])),
    requiresConfirmation:
      executorRef.provider !== "ollama" || (usesJudge && !!judgeRef && judgeRef.provider !== "ollama"),
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Where profiles and the runs behind them are kept: the user's HiveAI data
 * folder, so the app (also the packaged desktop build) and the CLI share
 * them. HIVEAI_EVAL_DIR overrides it — tests point it at a temp dir.
 */
export function evalDataDir(): string {
  return Deno.env.get("HIVEAI_EVAL_DIR") ?? join(homeDir, ".hiveai", "evals");
}

export const profilesDir = () => join(evalDataDir(), "profiles");
export const evalResultsDir = () => join(evalDataDir(), "results");

export function modelFileSafe(label: string): string {
  return label.replaceAll(/[:/\\]/g, "-");
}

export function profilePath(fileSafe: string): string {
  return join(profilesDir(), `${fileSafe}.json`);
}

export async function loadProfile(fileSafe: string, model: string): Promise<ModelProfile> {
  try {
    const text = await Deno.readTextFile(profilePath(fileSafe));
    return JSON.parse(text) as ModelProfile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return emptyProfile(model);
    throw error;
  }
}

/** Writes via a temp file + rename, so an interrupted write can never leave
 *  a half-written (corrupt) profile in place of the previous one. */
export async function saveProfile(fileSafe: string, profile: ModelProfile): Promise<string> {
  await Deno.mkdir(profilesDir(), { recursive: true });
  const path = profilePath(fileSafe);
  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(profile, null, 2) + "\n");
  await Deno.rename(tmp, path);
  return path;
}
