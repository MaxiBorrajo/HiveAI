import { modelRefLabel } from "../../../tests/llm-eval/model-ref.ts";
import { loadProfile, modelFileSafe } from "../../../tests/llm-eval/profile.ts";
import { modelOptionId } from "../../../core/ai/providers/model-selection.ts";
import type { Candidate, Catalog, EvalSignal, TaskType } from "../types.ts";

/**
 * Eval results per model for a task. Only the categories the catalog maps to
 * the task count; a model with none of them evaluated has no signal.
 */
export async function loadEvalSignals(
  candidates: Candidate[],
  catalog: Catalog,
  task: TaskType,
): Promise<Record<string, EvalSignal>> {
  const categories = catalog.evalMapping[task];
  if (!categories?.length) return {};
  const signals: Record<string, EvalSignal> = {};
  for (const c of candidates) {
    try {
      const label = modelRefLabel(c.ref);
      const profile = await loadProfile(modelFileSafe(label), label);
      const results = categories.map((cat) => profile.latest[cat]).filter(Boolean);
      if (results.length === 0) continue;
      signals[modelOptionId(c.ref)] = {
        value: results.reduce((sum, r) => sum + r.value, 0) / results.length,
        lowConfidence: results.some((r) => r.lowConfidence),
      };
    } catch {
      // an unreadable profile is simply no signal
    }
  }
  return signals;
}
