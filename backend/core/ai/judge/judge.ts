import { HumanMessage } from "@langchain/core/messages";
import { Scout } from "../strategy/scout/graph.ts";
import { splitContent } from "../providers/capabilities.ts";
import { normalizeProviderError } from "../providers/errors.ts";
import type { ModelRef } from "../providers/types.ts";
import { withUsageContext } from "../usage/usage-context.ts";
import { executionContextStorage } from "../../microkernel/human-interaction.ts";

/** Bump when the grading prompt or the score scale changes. */
export const JUDGE_VERSION = 1;

export const MIN_SCORE = 1;
export const MAX_SCORE = 10;

export interface JudgeInput {
  input: unknown;
  output: unknown;
  rubric: string;
  reference?: string | null;
}

export type JudgeOutcome =
  | { ok: true; score: number; reasoning: string }
  | { ok: false; error: string };

export interface JudgeDeps {
  /** Runs the judge agent and returns its final answer text. */
  runAgent?: (
    ref: ModelRef,
    prompt: string,
    signal?: AbortSignal,
  ) => Promise<string>;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function buildJudgePrompt(
  { input, output, rubric, reference }: JudgeInput,
): string {
  return `You are an impartial judge grading the result of one run of an AI workflow.
You may use your tools (for example web search) when you need facts to grade fairly.

Grade the result from ${MIN_SCORE} (fails the rubric) to ${MAX_SCORE} (fully satisfies it), using only the rubric${
    reference ? " and the reference answer" : ""
  }.

When you are done, finish your answer with exactly these two lines:
SCORE: <integer ${MIN_SCORE}-${MAX_SCORE}>
REASON: <one or two sentences justifying the score>

## Run input
${asText(input)}

## Run result
${asText(output)}

## Rubric
${rubric}
${reference ? `\n## Reference answer\n${reference}\n` : ""}`;
}

/** Reads the last SCORE/REASON pair, so earlier reasoning can't confuse it. */
export function parseJudgeAnswer(text: string): JudgeOutcome {
  const scores = [...text.matchAll(/SCORE:\s*\**\s*(\d+(?:\.\d+)?)/gi)];
  const last = scores[scores.length - 1];
  if (!last) {
    return { ok: false, error: `Judge format error: ${text.slice(0, 200)}` };
  }
  const score = Math.round(Number(last[1]));
  if (!(score >= MIN_SCORE && score <= MAX_SCORE)) {
    return {
      ok: false,
      error: `Judge score out of range (${MIN_SCORE}-${MAX_SCORE}): ${last[1]}`,
    };
  }
  const afterScore = text.slice((last.index ?? 0) + last[0].length);
  const reason = afterScore.match(/REASON:\s*([\s\S]+)/i)?.[1]?.trim();
  return { ok: true, score, reasoning: reason || "(no reason given)" };
}

async function runScoutJudge(
  ref: ModelRef,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  return await withUsageContext(
    { kind: "judge", role: "orchestrator" },
    () =>
      executionContextStorage.run({ autoApprove: false, unattended: true, signal }, async () => {
        const state = await Scout.invoke(
          {
            messages: [new HumanMessage(prompt)],
            chatId: "0",
            model: ref.model,
            modelProvider: ref.provider,
            modelKeyId: ref.keyId ?? "",
          },
          { signal },
        );
        const last = state.messages[state.messages.length - 1];
        return splitContent(last?.content).text;
      }),
  );
}

/**
 * Grades one run with the user's chosen model, which can call every active
 * plugin. Never throws: any failure becomes `{ ok: false }` so the caller can
 * leave the run "unevaluated" and carry on.
 */
export async function gradeRun(
  judgeRef: ModelRef,
  input: JudgeInput,
  deps: JudgeDeps = {},
  signal?: AbortSignal,
): Promise<JudgeOutcome> {
  const runAgent = deps.runAgent ?? runScoutJudge;
  try {
    const text = await runAgent(judgeRef, buildJudgePrompt(input), signal);
    return parseJudgeAnswer(text);
  } catch (error) {
    const normalized = normalizeProviderError(error, judgeRef.provider);
    return {
      ok: false,
      error: normalized instanceof Error ? normalized.message : String(normalized),
    };
  }
}
