import { modelOptionId } from "../../../core/ai/providers/model-selection.ts";
import type { ModelRef } from "../../../core/ai/providers/types.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { classifyTask, type TaskSignals } from "../../model-recommendations/lib/classify-task.ts";
import { getRecommendations } from "../../model-recommendations/recommend-for-task.ts";
import {
  type Recommendation,
  type RecommendationResult,
  type Suggestion,
  TASK_LABELS,
  type TaskType,
} from "../../model-recommendations/types.ts";

/** Shown under an assistant message: "it looks like you are doing X, try these models". */
export interface ModelSuggestion {
  task: TaskType;
  taskLabel: string;
  recommendations: Recommendation[];
  /** Nothing the user has fits: what to install or configure instead */
  suggestions: Suggestion[];
}

export interface SuggestModelsDeps {
  classify: typeof classifyTask;
  recommend: (task: TaskType, hive: HiveMicrokernel) => Promise<RecommendationResult>;
  timeoutMs: number;
}

export const SUGGESTION_TIMEOUT_MS = 5000;

const defaultDeps: SuggestModelsDeps = {
  classify: classifyTask,
  recommend: getRecommendations,
  timeoutMs: SUGGESTION_TIMEOUT_MS,
};

export interface SuggestModelsInput extends TaskSignals {
  currentRef: ModelRef;
  hive: HiveMicrokernel;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function suggest(
  input: SuggestModelsInput,
  deps: SuggestModelsDeps,
): Promise<ModelSuggestion | null> {
  const classified = await deps.classify(input, input.currentRef);
  if (!classified) return null;

  const result = await deps.recommend(classified.task, input.hive);
  if (result.noData) return null;

  // The model in use is already among the best for this task: nothing to say.
  const currentId = modelOptionId(input.currentRef);
  if (result.recommendations.some((r) => r.id === currentId)) return null;

  if (result.recommendations.length === 0 && result.suggestions.length === 0) return null;
  return {
    task: classified.task,
    taskLabel: TASK_LABELS[classified.task],
    recommendations: result.recommendations,
    suggestions: result.recommendations.length === 0 ? result.suggestions : [],
  };
}

/**
 * Optional extra for a chat turn. It must never break or noticeably delay the
 * answer, so any failure or timeout just means "no suggestion".
 */
export async function suggestModelsForTurn(
  input: SuggestModelsInput,
  deps: Partial<SuggestModelsDeps> = {},
): Promise<ModelSuggestion | null> {
  const resolved = { ...defaultDeps, ...deps };
  try {
    return await withTimeout(suggest(input, resolved), resolved.timeoutMs);
  } catch (error) {
    console.warn(
      "[Model suggestion] Skipped:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
