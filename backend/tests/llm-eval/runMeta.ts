import type { ModelRef } from "../../core/ai/providers/types.ts";
import type { EvalVerdict } from "./metrics.ts";
import { costUsd } from "./pricing.ts";
import { suiteOfCategory, type SuiteName } from "./casesVersion.ts";

/**
 * Stamps run-level facts on every verdict once a run is done: the executor's
 * and the judge's cost, which version of its suite's case set each case came
 * from, and the run's configuration labels. Kept on each line of the .jsonl
 * (rather than a separate header) so a run file stays self-describing and
 * old readers keep working.
 */
export function annotateRun(
  verdicts: EvalVerdict[],
  opts: {
    executorRef: ModelRef;
    judgeRef: ModelRef;
    casesVersions: Partial<Record<SuiteName, string>>;
    config: Record<string, string>;
  },
): EvalVerdict[] {
  return verdicts.map((v) => {
    const suite = suiteOfCategory(v.category);
    const judged = v.judged_by !== "exact";
    return {
      ...v,
      cost_usd: costUsd(opts.executorRef, v.input_tokens, v.output_tokens),
      judge_cost_usd: judged
        ? costUsd(opts.judgeRef, v.judge_input_tokens ?? 0, v.judge_output_tokens ?? 0)
        : undefined,
      cases_version: suite ? opts.casesVersions[suite] : undefined,
      config: opts.config,
    };
  });
}

/** Parses repeated `--config key=value` flags into a label map. */
export function parseConfigFlags(raw: string | string[] | undefined): Record<string, string> {
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const config: Record<string, string> = {};
  for (const item of list) {
    const eq = item.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid --config '${item}': expected key=value (e.g. --config rag=on).`);
    }
    config[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
  }
  return config;
}
