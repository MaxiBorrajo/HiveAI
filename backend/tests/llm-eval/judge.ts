import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChatModel } from "../../core/ai/providers/create-chat-model.ts";
import type { ModelRef } from "../../core/ai/providers/types.ts";

export interface JudgeResult {
  pass: boolean;
  reasoning: string;
}

const JUDGE_SYSTEM_PROMPT = `You are grading whether an AI agent's output satisfies a rubric.
Respond with exactly two lines:
VERDICT: PASS or FAIL
REASON: a single short sentence explaining why.
Do not add anything else.`;

function parseJudgeResponse(text: string): JudgeResult | undefined {
  const verdictMatch = text.match(/VERDICT:\s*(PASS|FAIL)/i);
  const reasonMatch = text.match(/REASON:\s*(.+)/i);
  if (!verdictMatch) return undefined;
  return {
    pass: verdictMatch[1].toUpperCase() === "PASS",
    reasoning: reasonMatch?.[1]?.trim() ?? "(no reason given)",
  };
}

export async function judgeWithLlm(
  judgeRef: ModelRef,
  question: string,
  actualOutput: string,
  rubric: string,
): Promise<JudgeResult> {
  const model = await createChatModel(judgeRef, { temperature: 0 });

  const prompt = `User request: ${question}

Agent output:
${actualOutput}

Rubric for a PASS: ${rubric}`;

  const response = await model.invoke([
    new SystemMessage(JUDGE_SYSTEM_PROMPT),
    new HumanMessage(prompt),
  ]);

  const text = String(response.content);
  const parsed = parseJudgeResponse(text);
  if (!parsed) {
    return { pass: false, reasoning: `judge format error: ${text.slice(0, 200)}` };
  }
  return parsed;
}
