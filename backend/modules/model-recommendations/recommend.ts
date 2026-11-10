import { modelOptionId } from "../../core/ai/providers/model-selection.ts";
import { costUsd } from "../../tests/llm-eval/pricing.ts";
import { evaluateFit } from "../hardware/use-cases/evaluate-compatibility.ts";
import type { FitContext, HardwareProfile } from "../hardware/types.ts";
import { findEntry } from "./lib/catalog-store.ts";
import {
  type Candidate,
  type Catalog,
  type CatalogEntry,
  type EvalSignal,
  type NotRecommended,
  type Recommendation,
  type RecommendationResult,
  type Suggestion,
  TASK_LABELS,
  type TaskType,
} from "./types.ts";

export const MAX_RECOMMENDATIONS = 3;
const SLOW_PENALTY = 0.15;
const MAX_COST_PENALTY = 0.25;
const COST_PENALTY_PER_USD = 8;
const EVAL_WEIGHT = 0.5;
const DEFAULT_TOKENS = { input: 2000, output: 500 };

export interface RecommendInput {
  task: TaskType;
  candidates: Candidate[];
  catalog: Catalog;
  /** null when the hardware could not be detected: local models are then not filtered */
  hardware: HardwareProfile | null;
  fitContext: FitContext;
  /** Keyed by model option id (`provider:model`) */
  evals?: Record<string, EvalSignal>;
}

function capabilityOf(
  candidate: Candidate,
  entry: CatalogEntry | undefined,
  kind: "vision" | "tools",
): Candidate["vision"] {
  // what the provider reports wins; the catalog fills in when it is silent
  const reported = candidate[kind];
  if (reported !== "unknown") return reported;
  const declared = entry?.capabilities?.[kind];
  return declared === undefined ? "unknown" : declared ? "supported" : "unsupported";
}

function estimatedCost(
  candidate: Candidate,
  entry: CatalogEntry,
  catalog: Catalog,
  task: TaskType,
): number | null {
  const tokens = catalog.typicalTokens[task] ?? DEFAULT_TOKENS;
  if (entry.price) {
    return (tokens.input * entry.price.input + tokens.output * entry.price.output) / 1_000_000;
  }
  return costUsd(candidate.ref, tokens.input, tokens.output);
}

function suggest(
  task: TaskType,
  catalog: Catalog,
  hardware: HardwareProfile | null,
  fitContext: FitContext,
): Suggestion[] {
  const needs = (e: CatalogEntry) =>
    (task !== "vision" || e.capabilities?.vision === true) &&
    (task !== "tools" || e.capabilities?.tools === true);
  const rated = catalog.entries
    .filter((e) => e.tasks[task] && needs(e))
    .sort((a, b) => b.tasks[task]!.score - a.tasks[task]!.score);
  const suggestions: Suggestion[] = [];

  const local = rated.find((e) => {
    if (e.provider !== "ollama" || !e.install) return false;
    if (!hardware) return true;
    const fit = evaluateFit(
      hardware,
      {
        sizeBytes: e.install.sizeBytes,
        paramsBillions: e.install.paramsBillions,
        contextLength: e.install.contextLength ?? null,
      },
      fitContext,
    );
    return fit.status !== "no_fit";
  });
  if (local?.install) {
    suggestions.push({
      kind: "install",
      model: local.install.ref,
      reason: `${local.tasks[task]!.reason} Fits your hardware and runs locally for free.`,
    });
  }

  const cloud = rated.find((e) => e.provider !== "ollama");
  if (cloud) {
    suggestions.push({
      kind: "configure-cloud",
      provider: cloud.provider,
      model: cloud.label ?? cloud.match,
      reason: `${cloud.tasks[task]!.reason} Add a ${cloud.provider} API key to use it.`,
    });
  }
  return suggestions;
}

export function recommend(input: RecommendInput): RecommendationResult {
  const { task, candidates, catalog, hardware, fitContext, evals = {} } = input;
  const base = {
    task,
    recommendations: [] as Recommendation[],
    notRecommended: [] as NotRecommended[],
    suggestions: [] as Suggestion[],
    unrated: 0,
  };

  // No data for this task anywhere in the catalog: say so, do not invent.
  if (!catalog.entries.some((e) => e.tasks[task])) {
    return {
      ...base,
      noData: true,
      message: `There is not enough data to recommend a model for "${TASK_LABELS[task]}".`,
    };
  }

  const scored: Recommendation[] = [];
  const notRecommended: NotRecommended[] = [];
  let unrated = 0;

  for (const c of candidates) {
    const id = modelOptionId(c.ref);
    const entry = findEntry(catalog, c.ref.provider, c.ref.model);
    const identity = { id, ref: c.ref, label: c.label, location: c.location };
    const reject = (reason: string) => notRecommended.push({ ...identity, reason });

    // Hard requirements first: they apply whether or not the catalog knows the model.
    if (task === "vision") {
      const vision = capabilityOf(c, entry, "vision");
      if (vision !== "supported") {
        reject(vision === "unsupported" ? "Does not support images." : "Image support is not declared for this model.");
        continue;
      }
    }
    if (task === "tools") {
      const tools = capabilityOf(c, entry, "tools");
      if (tools !== "supported") {
        reject(tools === "unsupported" ? "Does not support tool calling." : "Tool calling is not declared for this model.");
        continue;
      }
    }

    let fit: Recommendation["fit"];
    let penalty = 0;
    if (c.location === "local" && c.local && hardware) {
      const result = evaluateFit(hardware, c.local, fitContext);
      fit = { status: result.status, reason: result.reason };
      if (result.status === "no_fit") {
        reject(`Does not fit your hardware: ${result.reason}`);
        continue;
      }
      if (result.status === "slow") penalty += SLOW_PENALTY;
    }

    const taskScore = entry?.tasks[task];
    if (!entry || !taskScore) {
      unrated++;
      continue;
    }

    let cost: number | null | undefined;
    if (c.location === "cloud") {
      cost = estimatedCost(c, entry, catalog, task);
      if (cost !== null) penalty += Math.min(MAX_COST_PENALTY, cost * COST_PENALTY_PER_USD);
    }

    const evalSignal = evals[id];
    const useEval = !!evalSignal && !evalSignal.lowConfidence;
    const score = (useEval
      ? (1 - EVAL_WEIGHT) * taskScore.score + EVAL_WEIGHT * evalSignal.value
      : taskScore.score) - penalty;

    scored.push({
      ...identity,
      reason: fit?.status === "slow"
        ? `${taskScore.reason} Runs slowly on your hardware.`
        : taskScore.reason,
      basis: useEval ? "capabilities+cost+evals" : "capabilities+cost",
      score: Math.round(score * 1000) / 1000,
      ...(cost !== undefined ? { estimatedCostUsd: cost } : {}),
      ...(fit ? { fit } : {}),
    });
  }

  scored.sort((a, b) =>
    b.score - a.score ||
    (a.location === b.location ? 0 : a.location === "local" ? -1 : 1) ||
    (a.estimatedCostUsd ?? 0) - (b.estimatedCostUsd ?? 0)
  );
  const recommendations = scored.slice(0, MAX_RECOMMENDATIONS);

  if (recommendations.length === 0) {
    return {
      ...base,
      notRecommended,
      unrated,
      noData: false,
      message: `None of your available models is suitable for "${TASK_LABELS[task]}".`,
      suggestions: suggest(task, catalog, hardware, fitContext),
    };
  }
  return { ...base, recommendations, notRecommended, unrated, noData: false };
}
