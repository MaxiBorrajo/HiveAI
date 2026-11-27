import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { detectHardware } from "../hardware/lib/detect-hardware.ts";
import { getFitContext } from "../hardware/use-cases/get-fit-context.ts";
import { buildCandidates } from "./lib/build-candidates.ts";
import { loadCatalog } from "./lib/catalog-store.ts";
import { loadEvalSignals } from "./lib/eval-signal.ts";
import { recommend } from "./recommend.ts";
import type { RecommendationResult, TaskType } from "./types.ts";

/** Recommendations for a task from what the user has right now (installed + keyed models, hardware, evals). */
export async function getRecommendations(
  task: TaskType,
  hive: HiveMicrokernel,
): Promise<RecommendationResult> {
  const [{ catalog }, candidates, hardware, fit] = await Promise.all([
    loadCatalog(),
    buildCandidates(),
    detectHardware().catch(() => null),
    getFitContext(hive),
  ]);
  const evals = await loadEvalSignals(candidates, catalog, task);
  return recommend({ task, candidates, catalog, hardware, fitContext: fit.context, evals });
}
