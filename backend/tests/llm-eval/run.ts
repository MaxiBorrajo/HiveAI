import { parseArgs } from "@std/cli/parse-args";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { initORM } from "../../infrastructure/db/orm.ts";
import CounterPlugin from "../../plugins/counter/index.ts";
import CurrentDatetimePlugin from "../../plugins/current-datetime/index.ts";
import FileReadPlugin from "../../plugins/file-read/index.ts";
import WebSearchPlugin from "../../plugins/web-search/index.ts";
import { evalCases, type EvalCase } from "./cases.ts";
import { Scout } from "../../core/ai/strategy/scout/graph.ts";
import { parseModelArg, withKeyId, modelRefLabel, ensureOllamaModelAvailable, envSecretResolver } from "./model-ref.ts";
import { setSecretResolver } from "../../core/ai/providers/create-chat-model.ts";
import type { ModelRef } from "../../core/ai/providers/types.ts";
import { makeRunId, writeReport, type EvalVerdict, type EvalLang } from "./metrics.ts";
import { installInMemoryUsageRecorder, captureUsage } from "./usage-capture.ts";
import { runGeneratorSuite } from "./runGenerator.ts";
import { runExecutionSuite } from "./runExecutions.ts";

const AVAILABLE_PLUGINS = [CounterPlugin, CurrentDatetimePlugin, FileReadPlugin, WebSearchPlugin];
const MAX_TOOL_CALLS = 5;
const SCOUT_RECURSION_LIMIT = MAX_TOOL_CALLS * 2;
// The eval runs unattended — tools that wait on a human (ask_user, approvals)
// would otherwise hang forever since nobody is there to answer. This bounds
// each case so a stuck call surfaces as a failed case, not a frozen process.
const CASE_TIMEOUT_MS = 120_000;

interface CaseOutcome {
  case: EvalCase;
  pass: boolean;
  selectedTool: string | null;
  extractedParams?: Record<string, unknown>;
  detail: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

function extractFirstToolCall(
  messages: unknown[],
): { name: string; args: Record<string, unknown> } | undefined {
  for (const msg of messages) {
    const aiMsg = msg as AIMessage;
    if (aiMsg.type === "ai" && aiMsg.tool_calls?.length) {
      const call = aiMsg.tool_calls[0];
      return { name: call.name, args: call.args as Record<string, unknown> };
    }
  }
  return undefined;
}

function buildMessages(testCase: EvalCase, lang: EvalLang): BaseMessage[] {
  const priorTurns = (lang === "es" ? testCase.priorTurnsEs : undefined) ?? testCase.priorTurns ?? [];
  const query = (lang === "es" ? testCase.queryEs : undefined) ?? testCase.query;
  const prior = priorTurns.map((turn) =>
    turn.role === "user" ? new HumanMessage(turn.content) : new AIMessage(turn.content),
  );
  return [...prior, new HumanMessage(query)];
}

async function runCase(
  hive: HiveMicrokernel,
  executorRef: ModelRef,
  testCase: EvalCase,
  lang: EvalLang,
): Promise<CaseOutcome> {
  for (const plugin of hive.getRegisteredPlugins()) {
    if (testCase.activePlugins.includes(plugin.name)) {
      await hive.activate(plugin.name);
    } else {
      await hive.deactivate(plugin.name);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CASE_TIMEOUT_MS);

  const invoke = () =>
    Scout.invoke(
      {
        messages: buildMessages(testCase, lang),
        chatId: "llm-eval",
        model: executorRef.model,
        modelProvider: executorRef.provider,
        modelKeyId: executorRef.keyId ?? "",
        modelOptions: {},
      },
      { recursionLimit: SCOUT_RECURSION_LIMIT, signal: controller.signal },
    );

  let result, usage;
  try {
    ({ result, usage } = await captureUsage(invoke));
  } finally {
    clearTimeout(timeout);
  }

  const call = extractFirstToolCall(result.messages ?? []);
  const selectedTool = call?.name ?? null;
  const base = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, durationMs: usage.durationMs };

  if (testCase.expectedTool === null) {
    const pass = selectedTool === null;
    return {
      case: testCase,
      pass,
      selectedTool,
      detail: pass ? "correctly called no tool" : `expected no tool call, but got '${selectedTool}'`,
      ...base,
    };
  }

  if (selectedTool !== testCase.expectedTool) {
    return {
      case: testCase,
      pass: false,
      selectedTool,
      detail: `expected '${testCase.expectedTool}', got '${selectedTool ?? "none"}'`,
      ...base,
    };
  }

  if (testCase.expectedParams) {
    const actual = call?.args ?? {};
    const mismatches: string[] = [];
    for (const [key, expected] of Object.entries(testCase.expectedParams)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expected)) {
        mismatches.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual[key])}`);
      }
    }
    if (mismatches.length > 0) {
      return {
        case: testCase,
        pass: false,
        selectedTool,
        extractedParams: actual,
        detail: `param mismatch: ${mismatches.join(", ")}`,
        ...base,
      };
    }
  }

  return {
    case: testCase,
    pass: true,
    selectedTool,
    extractedParams: call?.args,
    detail: "matched expectation",
    ...base,
  };
}

async function runRoutingSuite(executorRef: ModelRef, runId: string, lang: EvalLang): Promise<EvalVerdict[]> {
  if (executorRef.provider === "ollama") {
    const available = await ensureOllamaModelAvailable(executorRef.model);
    if (!available) {
      console.log(
        `SKIPPED (routing): Ollama model '${executorRef.model}' is not available. Run 'ollama pull ${executorRef.model}'.`,
      );
      return [];
    }
  }

  const tempDir = await Deno.makeTempDir();
  await initORM(tempDir);

  const hive = HiveMicrokernel.getInstance();
  hive.configure({ dataDir: tempDir, model: executorRef.model });
  for (const PluginClass of AVAILABLE_PLUGINS) {
    await hive.register(new PluginClass());
  }

  const verdicts: EvalVerdict[] = [];
  for (const testCase of evalCases) {
    console.log(`Running: ${testCase.name}`);
    try {
      const outcome = await runCase(hive, executorRef, testCase, lang);
      console.log(`  ${outcome.pass ? "PASS" : "FAIL"} — ${outcome.detail}`);
      verdicts.push({
        case_id: testCase.name,
        category: testCase.category,
        executor_model: modelRefLabel(executorRef),
        judge_model: modelRefLabel(executorRef),
        provider: executorRef.provider,
        pass: outcome.pass,
        judged_by: "exact",
        detail: outcome.detail,
        input_tokens: outcome.inputTokens,
        output_tokens: outcome.outputTokens,
        duration_ms: outcome.durationMs,
        run_id: runId,
      });
    } catch (error) {
      const detail = `threw: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`  ERROR — ${detail}`);
      verdicts.push({
        case_id: testCase.name,
        category: testCase.category,
        executor_model: modelRefLabel(executorRef),
        judge_model: modelRefLabel(executorRef),
        provider: executorRef.provider,
        pass: false,
        judged_by: "exact",
        detail,
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: 0,
        run_id: runId,
      });
    }
  }

  await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  return verdicts;
}

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
    default: { suite: "all", lang: "en" },
  });

  const executorRaw = args.executor ?? "qwen3:8b";
  const executorRef = withKeyId(parseModelArg(executorRaw), args["executor-key"]);
  const judgeRef = args.judge
    ? withKeyId(parseModelArg(args.judge), args["judge-key"] ?? args["executor-key"])
    : executorRef;
  const lang: EvalLang = args.lang === "es" ? "es" : "en";

  installInMemoryUsageRecorder();

  const runId = makeRunId(`${modelRefLabel(executorRef).replaceAll(/[:/\\]/g, "-")}${lang === "es" ? "-es" : ""}`);
  const suite = args.suite as string;

  const verdicts: EvalVerdict[] = [];
  if (suite === "all" || suite === "routing") {
    verdicts.push(...(await runRoutingSuite(executorRef, runId, lang)));
  }
  if (suite === "all" || suite === "generation") {
    verdicts.push(...(await runGeneratorSuite(executorRef, runId, lang)));
  }
  if (suite === "all" || suite === "execution") {
    verdicts.push(...(await runExecutionSuite(runId, executorRef)));
  }

  if (verdicts.length === 0) {
    console.log("No verdicts produced (all suites skipped or empty) — nothing to report.");
    return;
  }

  void judgeRef; // reserved for cases that opt into `judge?: string` — wired per-case in future cases
  const path = await writeReport(verdicts);
  console.log(`\nReport written to: ${path}`);
}

if (import.meta.main) {
  await main();
}
