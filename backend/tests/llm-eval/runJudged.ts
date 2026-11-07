import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { initORM } from "../../infrastructure/db/orm.ts";
import { Scout } from "../../core/ai/strategy/scout/graph.ts";
import { splitContent } from "../../core/ai/providers/capabilities.ts";
import { judgeWithLlm, JudgeFormatError } from "./judge.ts";
import { judgedEvalCases, type JudgedEvalCase } from "./judgedCases.ts";
import { modelRefLabel, ensureOllamaModelAvailable } from "./model-ref.ts";
import { captureUsage } from "./usage-capture.ts";
import { reportCaseStart } from "./progress.ts";
import type { EvalVerdict, EvalLang } from "./metrics.ts";
import type { ModelRef } from "../../core/ai/providers/types.ts";

const CASE_TIMEOUT_MS = 1000_000;

function extractFinalText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as AIMessage;
    if (msg.type === "ai" && !msg.tool_calls?.length) {
      return splitContent(msg.content).text;
    }
  }
  return "";
}

/**
 * Runs every case in judgedCases.ts against `executorRef`, then has
 * `judgeRef` grade the resulting text against each case's rubric/reference.
 * A case whose judge response can't be parsed is recorded as "unjudged"
 * (see JudgeFormatError in judge.ts) — it does not fail the run and does
 * not count toward the category's pass rate.
 */
export async function runJudgedSuite(
  executorRef: ModelRef,
  judgeRef: ModelRef,
  runId: string,
  lang: EvalLang = "en",
): Promise<EvalVerdict[]> {
  if (executorRef.provider === "ollama") {
    const available = await ensureOllamaModelAvailable(executorRef.model);
    if (!available) {
      console.log(
        `SKIPPED (summarization): Ollama executor model '${executorRef.model}' is not available. Run 'ollama pull ${executorRef.model}'.`,
      );
      return [];
    }
  }
  if (judgeRef.provider === "ollama") {
    const available = await ensureOllamaModelAvailable(judgeRef.model);
    if (!available) {
      console.log(
        `SKIPPED (summarization): Ollama judge model '${judgeRef.model}' is not available. Run 'ollama pull ${judgeRef.model}'.`,
      );
      return [];
    }
  }

  const tempDir = await Deno.makeTempDir();
  await initORM(tempDir);

  const hive = HiveMicrokernel.getInstance();
  hive.configure({ dataDir: tempDir, model: executorRef.model });

  const executorLabel = modelRefLabel(executorRef);
  const judgeLabel = modelRefLabel(judgeRef);

  const verdicts: EvalVerdict[] = [];
  for (const [index, testCase] of judgedEvalCases.entries()) {
    reportCaseStart("summarization", index, judgedEvalCases.length, testCase.name);
    const verdict = await runOneCase(hive, executorRef, judgeRef, testCase, lang, runId, executorLabel, judgeLabel);
    console.log(
      verdict.judged_by === "unjudged"
        ? `  UNJUDGED — ${verdict.detail}`
        : `  ${verdict.pass ? "PASS" : "FAIL"} (score ${verdict.score}) — ${verdict.detail}`,
    );
    verdicts.push(verdict);
  }

  await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  return verdicts;
}

async function runOneCase(
  hive: HiveMicrokernel,
  executorRef: ModelRef,
  judgeRef: ModelRef,
  testCase: JudgedEvalCase,
  lang: EvalLang,
  runId: string,
  executorLabel: string,
  judgeLabel: string,
): Promise<EvalVerdict> {
  for (const plugin of hive.getRegisteredPlugins()) {
    if (testCase.activePlugins.includes(plugin.name)) {
      await hive.activate(plugin.name);
    } else {
      await hive.deactivate(plugin.name);
    }
  }

  const query = (lang === "es" ? testCase.queryEs : undefined) ?? testCase.query;
  const messages: BaseMessage[] = [new HumanMessage(query)];

  const base = {
    case_id: testCase.name,
    category: "summarization" as const,
    executor_model: executorLabel,
    judge_model: judgeLabel,
    provider: executorRef.provider,
    rubric_version: testCase.rubricVersion,
    run_id: runId,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CASE_TIMEOUT_MS);

  let outputText: string;
  let executorUsage;
  try {
    const invoke = () =>
      Scout.invoke(
        {
          messages,
          chatId: "llm-eval",
          model: executorRef.model,
          modelProvider: executorRef.provider,
          modelKeyId: executorRef.keyId ?? "",
          modelOptions: {},
        },
        { signal: controller.signal },
      );
    const { result, usage } = await captureUsage(invoke);
    outputText = extractFinalText(result.messages ?? []);
    executorUsage = usage;
  } catch (error) {
    clearTimeout(timeout);
    const detail = `executor threw: ${error instanceof Error ? error.message : String(error)}`;
    return {
      ...base,
      pass: false,
      judged_by: "exact",
      detail,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: 0,
    };
  } finally {
    clearTimeout(timeout);
  }

  try {
    const { result: judged, usage: judgeUsage } = await captureUsage(() =>
      judgeWithLlm(judgeRef, query, outputText, {
        rubric: testCase.rubric,
        referenceAnswer: testCase.referenceAnswer,
      }),
    );
    return toVerdictFromJudgeOutcome(base, { ok: true, judged }, executorUsage, judgeUsage);
  } catch (error) {
    return toVerdictFromJudgeOutcome(base, { ok: false, error }, executorUsage);
  }
}

type JudgeOutcome =
  | { ok: true; judged: { pass: boolean; score: number; reasoning: string } }
  | { ok: false; error: unknown };

/**
 * Turns a judge call's outcome (a parsed score/verdict, or any failure —
 * JudgeFormatError or otherwise) into the EvalVerdict to record. Kept as a
 * pure function, separate from the actual judgeWithLlm() call, so the
 * "unjudged on failure" behavior can be unit-tested with a simulated judge
 * outcome instead of a real model call.
 */
export function toVerdictFromJudgeOutcome(
  base: Omit<
    EvalVerdict,
    | "pass"
    | "judged_by"
    | "score"
    | "detail"
    | "input_tokens"
    | "output_tokens"
    | "duration_ms"
    | "judge_input_tokens"
    | "judge_output_tokens"
    | "judge_duration_ms"
  >,
  outcome: JudgeOutcome,
  executorUsage: { inputTokens: number; outputTokens: number; durationMs: number },
  judgeUsage?: { inputTokens: number; outputTokens: number; durationMs: number },
): EvalVerdict {
  const executor = {
    input_tokens: executorUsage.inputTokens,
    output_tokens: executorUsage.outputTokens,
    duration_ms: executorUsage.durationMs,
  };

  if (outcome.ok) {
    const usage = judgeUsage ?? { inputTokens: 0, outputTokens: 0, durationMs: 0 };
    return {
      ...base,
      pass: outcome.judged.pass,
      judged_by: "llm-judge",
      score: outcome.judged.score,
      detail: outcome.judged.reasoning,
      ...executor,
      judge_input_tokens: usage.inputTokens,
      judge_output_tokens: usage.outputTokens,
      judge_duration_ms: usage.durationMs,
    };
  }

  const detail =
    outcome.error instanceof JudgeFormatError
      ? outcome.error.message
      : `judge threw: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`;

  return {
    ...base,
    pass: false,
    judged_by: "unjudged",
    detail,
    ...executor,
  };
}
