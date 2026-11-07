import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { GraphRecursionError } from "@langchain/langgraph";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { initORM } from "../../infrastructure/db/orm.ts";
import { executionContextStorage } from "../../core/microkernel/human-interaction.ts";
import CounterPlugin from "../../plugins/counter/index.ts";
import CurrentDatetimePlugin from "../../plugins/current-datetime/index.ts";
import FileReadPlugin from "../../plugins/file-read/index.ts";
import WebSearchPlugin from "../../plugins/web-search/index.ts";
import { evalCases, type EvalCase } from "./cases.ts";
import { Scout } from "../../core/ai/strategy/scout/graph.ts";
import { modelRefLabel, ensureOllamaModelAvailable } from "./model-ref.ts";
import type { ModelRef } from "../../core/ai/providers/types.ts";
import type { EvalVerdict, EvalLang } from "./metrics.ts";
import { captureUsage } from "./usage-capture.ts";
import { reportCaseStart } from "./progress.ts";

const AVAILABLE_PLUGINS = [CounterPlugin, CurrentDatetimePlugin, FileReadPlugin, WebSearchPlugin];
const MAX_TOOL_CALLS = 5;
const SCOUT_RECURSION_LIMIT = MAX_TOOL_CALLS * 2;
// The eval runs unattended: tools that wait on a human (ask_user, approvals)
// settle at once as declined / "the user did not answer". The routing verdict
// only looks at the first tool call, so asking is still graded. The timeout
// bounds anything else that gets stuck.
const CASE_TIMEOUT_MS = 300_000;

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

  // Streams the graph's state so that, if the model keeps calling tools past
  // the step limit, the case is still graded on the tool calls it already
  // made (the verdict only looks at the first one) instead of erroring out.
  const invoke = () =>
    executionContextStorage.run({ autoApprove: false, unattended: true }, async () => {
      let last: { messages?: unknown[] } = {};
      try {
        const stream = await Scout.stream(
          {
            messages: buildMessages(testCase, lang),
            chatId: "llm-eval",
            model: executorRef.model,
            modelProvider: executorRef.provider,
            modelKeyId: executorRef.keyId ?? "",
            modelOptions: {},
          },
          { recursionLimit: SCOUT_RECURSION_LIMIT, signal: controller.signal, streamMode: "values" },
        );
        for await (const state of stream) last = state;
        return { messages: last.messages ?? [], hitStepLimit: false };
      } catch (error) {
        if (!(error instanceof GraphRecursionError)) throw error;
        return { messages: last.messages ?? [], hitStepLimit: true };
      }
    });

  let result, usage;
  try {
    ({ result, usage } = await captureUsage(invoke));
  } finally {
    clearTimeout(timeout);
  }

  const call = extractFirstToolCall(result.messages);
  const base = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, durationMs: usage.durationMs };
  const outcome = gradeCall(testCase, call, base);
  if (result.hitStepLimit) outcome.detail += ` (stopped at the ${SCOUT_RECURSION_LIMIT}-step limit)`;
  return outcome;
}

function gradeCall(
  testCase: EvalCase,
  call: { name: string; args: Record<string, unknown> } | undefined,
  base: Pick<CaseOutcome, "inputTokens" | "outputTokens" | "durationMs">,
): CaseOutcome {
  const selectedTool = call?.name ?? null;

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

export async function runRoutingSuite(executorRef: ModelRef, runId: string, lang: EvalLang): Promise<EvalVerdict[]> {
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
  for (const [index, testCase] of evalCases.entries()) {
    reportCaseStart("routing", index, evalCases.length, testCase.name);
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
