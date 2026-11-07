import { parseArgs } from "@std/cli/parse-args";
import {
  parseModelArg,
  withKeyId,
  modelRefLabel,
  envSecretResolver,
  ollamaModelDigest,
} from "./model-ref.ts";
import { setSecretResolver, type SecretResolver } from "../../core/ai/providers/create-chat-model.ts";
import { makeRunId, writeReport, type EvalLang } from "./metrics.ts";
import { installInMemoryUsageRecorder } from "./usage-capture.ts";
import type { ModelRef } from "../../core/ai/providers/types.ts";
import { ALL_SUITES, allCasesVersions, SUITE_CATEGORIES, type SuiteName } from "./casesVersion.ts";
import { JUDGED_SUITES, judgeProblem, runSuite } from "./suites.ts";
import { annotateRun } from "./runMeta.ts";
import { formatCost } from "./pricing.ts";
import { reportProgress } from "./progress.ts";
import {
  buildMetricResults,
  checkStaleness,
  estimateRun,
  evalResultsDir,
  loadProfile,
  mergeIntoProfile,
  modelFileSafe,
  saveProfile,
} from "./profile.ts";

/** Exit code when a cloud run was asked for without --confirm. */
export const EXIT_NEEDS_CONFIRMATION = 2;

const USAGE =
  "Usage: deno task eval:profile -- --executor=<model> [--judge=<model>] " +
  `[--categories=all|${ALL_SUITES.join(",")}] [--confirm] [--estimate]`;

/**
 * Profiles one model: runs the chosen suites against it and records each
 * metric (value, level, cost, versions...) in its profile. Used by the CLI
 * (`deno task eval:profile`) and by the app, which runs it in a child
 * process (see main.ts) so a run never touches the app's own state.
 *
 * Each suite's metrics are saved as soon as that suite finishes. If the run
 * is cancelled or fails half-way, finished suites are kept and the suite in
 * progress leaves the previous result for its metrics untouched.
 */
export async function runProfile(
  argv: string[],
  secretResolver: SecretResolver = envSecretResolver,
): Promise<number> {
  setSecretResolver(secretResolver);

  const rawArgs = argv[0] === "--" ? argv.slice(1) : argv;
  const args = parseArgs(rawArgs, {
    string: ["executor", "judge", "executor-key", "judge-key", "categories", "lang"],
    boolean: ["confirm", "estimate", "allow-self-judge"],
    default: { categories: "all", lang: "en", confirm: false, estimate: false, "allow-self-judge": false },
  });

  if (!args.executor) {
    console.error(USAGE);
    return 1;
  }

  const executorRef = withKeyId(parseModelArg(args.executor), args["executor-key"]);
  const judgeRef: ModelRef | undefined = args.judge
    ? withKeyId(parseModelArg(args.judge), args["judge-key"])
    : undefined;
  const lang: EvalLang = args.lang === "es" ? "es" : "en";

  const suites: SuiteName[] = args.categories === "all"
    ? ALL_SUITES
    : (args.categories.split(",").map((s) => s.trim()) as SuiteName[]);
  for (const s of suites) {
    if (!ALL_SUITES.includes(s)) {
      console.error(`Unknown category '${s}'. Available: ${ALL_SUITES.join(", ")}`);
      return 1;
    }
  }

  const problem = judgeProblem(executorRef, judgeRef, args["allow-self-judge"]);
  const judgedRequested = suites.filter((s) => JUDGED_SUITES.includes(s));
  if (problem && judgedRequested.length > 0) {
    if (suites.length === judgedRequested.length) {
      console.error(`Can't run ${judgedRequested.join(", ")}: ${problem}.`);
      return 1;
    }
    for (const s of judgedRequested) {
      console.log(`SKIPPED (${s}): ${problem}.`);
      reportProgress({ type: "suite-skipped", suite: s, reason: problem });
    }
  }
  const runnable = problem ? suites.filter((s) => !JUDGED_SUITES.includes(s)) : suites;

  const label = modelRefLabel(executorRef);
  const fileSafe = modelFileSafe(label);
  let profile = await loadProfile(fileSafe, label);

  const estimate = estimateRun(executorRef, judgeRef, runnable, profile, JUDGED_SUITES);
  if (args.estimate) {
    console.log(JSON.stringify(estimate));
    return 0;
  }
  console.log(`\nEstimated cost: ${formatCost(estimate.totalCostUsd)}`);
  if (estimate.requiresConfirmation && !args.confirm) {
    console.error(
      `This run uses a cloud model — it makes real API calls (estimated ${formatCost(estimate.totalCostUsd)}).\n` +
        `Re-run with --confirm to proceed.`,
    );
    return EXIT_NEEDS_CONFIRMATION;
  }

  installInMemoryUsageRecorder();
  const runId = makeRunId(fileSafe);
  const casesVersions = await allCasesVersions();
  const categoryVersions: Record<string, string> = {};
  for (const s of ALL_SUITES) {
    for (const c of SUITE_CATEGORIES[s]) categoryVersions[c] = casesVersions[s];
  }
  const modelVersion = executorRef.provider === "ollama"
    ? await ollamaModelDigest(executorRef.model)
    : undefined;

  for (const suite of runnable) {
    console.log(`\n=== Profiling '${label}' on: ${suite} ===`);
    reportProgress({ type: "suite-start", suite, total: 0 });

    let verdicts;
    try {
      verdicts = await runSuite(suite, executorRef, judgeRef, `${runId}-${suite}`, lang);
    } catch (error) {
      console.error(
        `\nProfiling '${suite}' failed (${error instanceof Error ? error.message : String(error)}).\n` +
          `Its previous results for '${label}' are unchanged; suites finished before it were saved.`,
      );
      return 1;
    }

    if (verdicts.length === 0) {
      reportProgress({ type: "suite-skipped", suite, reason: "no cases ran (model unavailable?)" });
      continue;
    }

    const annotated = annotateRun(verdicts, {
      executorRef,
      judgeRef: judgeRef ?? executorRef,
      casesVersions,
      config: {},
    });
    await writeReport(annotated, evalResultsDir());

    const results = buildMetricResults(annotated, categoryVersions, {
      modelVersion,
      runId: annotated[0].run_id,
    });
    for (const r of results) {
      const prior = profile.latest[r.category];
      const stale = prior ? checkStaleness(prior, r) : { stale: false, reasons: [] };
      console.log(
        `${r.category}: ${(r.value * 100).toFixed(0)}% -> ${r.level}` +
          (r.lowConfidence ? ` (low confidence: only ${r.casesGraded} cases)` : "") +
          (r.casesUnjudged > 0 ? `, ${r.casesUnjudged} unjudged` : "") +
          (stale.stale ? ` [previous result was stale: ${stale.reasons.join("; ")}]` : ""),
      );
    }

    profile = mergeIntoProfile(profile, results);
    const path = await saveProfile(fileSafe, profile);
    console.log(`Profile updated: ${path}`);
    reportProgress({ type: "suite-saved", suite });
  }

  return 0;
}

if (import.meta.main) {
  Deno.exit(await runProfile(Deno.args));
}
