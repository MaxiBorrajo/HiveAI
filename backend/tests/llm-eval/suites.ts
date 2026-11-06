import type { ModelRef } from "../../core/ai/providers/types.ts";
import type { EvalLang, EvalVerdict } from "./metrics.ts";
import { runRoutingSuite } from "./runRouting.ts";
import { runGeneratorSuite } from "./runGenerator.ts";
import { runExecutionSuite } from "./runExecutions.ts";
import { runJudgedSuite } from "./runJudged.ts";
import { isSameModel } from "./judge.ts";
import { modelRefLabel } from "./model-ref.ts";
import type { SuiteName } from "./casesVersion.ts";

/** Suites graded by an LLM judge rather than by exact matching. */
export const JUDGED_SUITES: SuiteName[] = ["summarization"];

export async function runSuite(
  suite: SuiteName,
  executorRef: ModelRef,
  judgeRef: ModelRef | undefined,
  runId: string,
  lang: EvalLang,
): Promise<EvalVerdict[]> {
  switch (suite) {
    case "routing":
      return await runRoutingSuite(executorRef, runId, lang);
    case "generation":
      return await runGeneratorSuite(executorRef, runId, lang);
    case "execution":
      return await runExecutionSuite(runId, executorRef);
    case "summarization":
      if (!judgeRef) throw new Error("The summarization suite needs a judge model.");
      return await runJudgedSuite(executorRef, judgeRef, runId, lang);
  }
}

/**
 * Why a judged suite can't run with this judge, or undefined if it can.
 * The judge must be chosen explicitly and be a different model than the one
 * being evaluated — a model grading its own answers is not an independent
 * measure. `allowSelfJudge` exists only for quick local smoke tests.
 */
export function judgeProblem(
  executorRef: ModelRef,
  judgeRef: ModelRef | undefined,
  allowSelfJudge = false,
): string | undefined {
  if (!judgeRef) {
    return "no judge model chosen (pass --judge=<model>)";
  }
  if (isSameModel(executorRef, judgeRef) && !allowSelfJudge) {
    return `the judge '${modelRefLabel(judgeRef)}' is the same model being evaluated; choose a different --judge (or pass --allow-self-judge for a smoke test)`;
  }
  return undefined;
}
