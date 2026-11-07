import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { createChatModel } from "../../core/ai/providers/create-chat-model.ts";
import { splitContent } from "../../core/ai/providers/capabilities.ts";
import type { ModelRef } from "../../core/ai/providers/types.ts";

/**
 * PASS_SCORE_THRESHOLD is the score (0-100, inclusive) at or above which a
 * judged case counts as a pass. The judge only returns a score; pass/fail is
 * always derived from it here, so a run's pass rate and its average score
 * can never disagree about what "passing" means.
 */
export const PASS_SCORE_THRESHOLD = 70;

export interface JudgeResult {
  pass: boolean;
  score: number;
  reasoning: string;
}

/**
 * Thrown when the judge model's response can't be parsed into a verdict —
 * e.g. it ignored the output format. Callers should catch this and record
 * the case as "unjudged" rather than letting it crash the run or silently
 * counting as a fail.
 */
export class JudgeFormatError extends Error {
  constructor(public readonly rawResponse: string) {
    super(`Judge response did not match the expected format: ${rawResponse.slice(0, 200)}`);
    this.name = "JudgeFormatError";
  }
}

const JUDGE_SYSTEM_PROMPT = `You are grading how well an AI agent's output satisfies a rubric, and/or how well it matches a reference answer.
Respond with exactly two lines, in this order:
SCORE: a whole number from 0 to 100, where 100 fully satisfies the rubric/reference and 0 does not satisfy it at all.
REASON: a single short sentence explaining the score.
Do not add anything else.`;

/**
 * Parses the judge's reply. Only SCORE is required; a VERDICT line (from
 * older prompts, or a model that adds one anyway) is ignored, since pass/fail
 * comes from PASS_SCORE_THRESHOLD.
 */
export function parseJudgeResponse(text: string): JudgeResult | undefined {
  const scoreMatch = text.match(/SCORE:\s*(\d{1,3})/i);
  const reasonMatch = text.match(/REASON:\s*(.+)/i);
  if (!scoreMatch) return undefined;

  const score = Math.max(0, Math.min(100, parseInt(scoreMatch[1], 10)));
  return {
    score,
    pass: score >= PASS_SCORE_THRESHOLD,
    reasoning: reasonMatch?.[1]?.trim() ?? "(no reason given)",
  };
}

export interface JudgeCriteria {
  /** Free-text grading rubric for a PASS. */
  rubric?: string;
  /** A reference answer the output is expected to match in substance. */
  referenceAnswer?: string;
}

/** The slice of a chat model the judge needs — lets tests pass a fake. */
export interface JudgeModel {
  invoke(messages: BaseMessage[]): Promise<{ content: unknown }>;
}

export type JudgeModelFactory = (ref: ModelRef) => Promise<JudgeModel>;

const defaultJudgeModelFactory: JudgeModelFactory = (ref) =>
  createChatModel(ref, { temperature: 0 });

/**
 * Asks `judgeRef` to grade `actualOutput` against a rubric and/or a
 * reference answer. At least one of `criteria.rubric` /
 * `criteria.referenceAnswer` must be given.
 *
 * Throws `JudgeFormatError` if the judge model's response can't be parsed —
 * callers decide how to record that (e.g. as an "unjudged" case) rather than
 * this function silently downgrading it to a fail, which would be
 * indistinguishable from the agent actually doing badly.
 */
export async function judgeWithLlm(
  judgeRef: ModelRef,
  question: string,
  actualOutput: string,
  criteria: JudgeCriteria,
  createModel: JudgeModelFactory = defaultJudgeModelFactory,
): Promise<JudgeResult> {
  if (!criteria.rubric && !criteria.referenceAnswer) {
    throw new Error("judgeWithLlm requires at least a rubric or a referenceAnswer.");
  }

  const model = await createModel(judgeRef);

  const criteriaLines = [
    criteria.rubric ? `Rubric for a PASS: ${criteria.rubric}` : null,
    criteria.referenceAnswer ? `Reference answer: ${criteria.referenceAnswer}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const prompt = `User request: ${question}

Agent output:
${actualOutput}

${criteriaLines}`;

  const response = await model.invoke([
    new SystemMessage(JUDGE_SYSTEM_PROMPT),
    new HumanMessage(prompt),
  ]);

  // Reasoning models (qwen3, etc.) put a <think> block before the answer;
  // grade only the visible answer so a "SCORE:" mentioned while thinking
  // can't be picked up by mistake.
  const text = splitContent(response.content).text.replaceAll(/<think>[\s\S]*?<\/think>/gi, "");
  const parsed = parseJudgeResponse(text);
  if (!parsed) {
    throw new JudgeFormatError(text);
  }
  return parsed;
}

/** Whether two refs point at the same model, ignoring which key is used. */
export function isSameModel(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.model === b.model;
}
