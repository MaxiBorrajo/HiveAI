import { parseArgs } from "@std/cli/parse-args";
import { parseModelArg, withKeyId, modelRefLabel, envSecretResolver } from "./model-ref.ts";
import { setSecretResolver } from "../../core/ai/providers/create-chat-model.ts";
import { makeRunId, writeReport, type EvalVerdict, type EvalLang } from "./metrics.ts";
import { installInMemoryUsageRecorder } from "./usage-capture.ts";
import { ALL_SUITES, allCasesVersions, type SuiteName } from "./casesVersion.ts";
import { JUDGED_SUITES, judgeProblem, runSuite } from "./suites.ts";
import { annotateRun, parseConfigFlags } from "./runMeta.ts";

async function main() {
  // The eval is a standalone script, not the app (main.ts never ran), so the
  // global secret resolver used by createChatModel() for cloud providers is
  // still unset. Point it at process env vars instead of the app's
  // api_keys/SecretStore, so running against a cloud model never depends on
  // anyone having saved a key through the UI first.
  setSecretResolver(envSecretResolver);

  // `deno task eval -- --executor=X` leaves a literal "--" as the first
  // element of Deno.args; parseArgs treats everything after it as positional
  // unless it's stripped first.
  const rawArgs = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
  const args = parseArgs(rawArgs, {
    string: ["executor", "judge", "executor-key", "judge-key", "suite", "lang"],
    boolean: ["allow-self-judge"],
    collect: ["config"],
    default: { suite: "all", lang: "en", "allow-self-judge": false },
  });

  const executorRaw = args.executor ?? "qwen3:8b";
  const executorRef = withKeyId(parseModelArg(executorRaw), args["executor-key"]);
  const judgeRef = args.judge
    ? withKeyId(parseModelArg(args.judge), args["judge-key"] ?? args["executor-key"])
    : undefined;
  const lang: EvalLang = args.lang === "es" ? "es" : "en";
  const config = parseConfigFlags(args.config as string[]);

  const suite = args.suite as string;
  if (suite !== "all" && !ALL_SUITES.includes(suite as SuiteName)) {
    console.error(`Unknown --suite '${suite}'. Available: all, ${ALL_SUITES.join(", ")}`);
    Deno.exit(1);
  }
  const suites = suite === "all" ? ALL_SUITES : [suite as SuiteName];

  // Exact-match suites never need a judge. A judged suite without a valid,
  // independent judge is skipped when running "all" (so the rest still runs)
  // and is an error when it was asked for explicitly.
  const problem = judgeProblem(executorRef, judgeRef, args["allow-self-judge"]);
  const runnable = suites.filter((s) => !JUDGED_SUITES.includes(s) || !problem);
  for (const s of suites.filter((s) => !runnable.includes(s))) {
    if (suite !== "all") {
      console.error(`Can't run '${s}': ${problem}.`);
      Deno.exit(1);
    }
    console.log(`SKIPPED (${s}): ${problem}.`);
  }

  installInMemoryUsageRecorder();

  const runId = makeRunId(`${modelRefLabel(executorRef).replaceAll(/[:/\\]/g, "-")}${lang === "es" ? "-es" : ""}`);

  const verdicts: EvalVerdict[] = [];
  for (const s of runnable) {
    verdicts.push(...(await runSuite(s, executorRef, judgeRef, runId, lang)));
  }

  if (verdicts.length === 0) {
    console.log("No verdicts produced (all suites skipped or empty) — nothing to report.");
    return;
  }

  const annotated = annotateRun(verdicts, {
    executorRef,
    judgeRef: judgeRef ?? executorRef,
    casesVersions: await allCasesVersions(),
    config,
  });
  const path = await writeReport(annotated);
  console.log(`\nReport written to: ${path}`);
}

if (import.meta.main) {
  await main();
}
