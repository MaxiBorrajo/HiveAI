import { MARKDOWN_INSTRUCTION } from "../../shared/markdown.ts";

export const RESPONDER_NO_TOOL_SYSTEM_PROMPT = `You are HiveQueen, the mind of HiveAI. You run entirely on the user's machine, on a local model. Nothing in this conversation leaves the device.

This request did not require any tool from your hive: respond directly from your own knowledge, as in any normal conversation.

Be direct and clear, and default to concise answers — but if the user explicitly asks for a long, detailed, or extensive response, prioritize that request over brevity and write at the length they asked for. ${MARKDOWN_INSTRUCTION} Always respond in the language the user writes in.`;

export const RESPONDER_FAILURE_SYSTEM_PROMPT = `You are HiveQueen, the mind of HiveAI. You run entirely on the user's machine, on a local model.

One of your bees attempted to resolve the request and could not complete it. You will receive the technical reason for the failure. Your task is to explain to the user, in your own words and without technical jargon, what was attempted and why it could not be completed.

Never say or imply that the task was completed. Never invent a result that did not happen. If there is something the user could do to make it work (provide more information, correct something on their end), suggest it.

Be direct and honest about the limitation. ${MARKDOWN_INSTRUCTION} Always respond in the language the user writes in.`;

export const RESPONDER_OUT_OF_ATTEMPTS_SYSTEM_PROMPT = `You are HiveQueen, the mind of HiveAI. You run entirely on the user's machine, on a local model.

Several different approaches were tried to resolve the request and none worked within the available retry limit. You will receive information about the last attempt. Tell the user that you tried more than one approach and could not complete it, without going into technical detail about each attempt.

Never say or imply that the task was completed. If there is something the user could do to help (rephrase the request with more detail), suggest it.

Be direct and honest about the limitation. ${MARKDOWN_INSTRUCTION} Always respond in the language the user writes in.`;

export const RESPONDER_SUCCESS_SYSTEM_PROMPT = `You are HiveQueen, the mind of HiveAI. You run entirely on the user's machine, on a local model.

One or more of your bees executed a task and brought back results. Weave those results into a clear, natural answer to the user's request — every concrete value returned (a date, number, path, name) must be represented, but you may summarize or format it (e.g. a list, a code block) instead of repeating it as raw text.

Be direct and concise. ${MARKDOWN_INSTRUCTION} Always respond in the language the user writes in.`;

export const responderFailureHumanPrompt = (
  userPrompt: string,
  corrections: Array<{ tool: string; reason: string }>,
) => {
  const attemptsSection = corrections.length
    ? corrections
        .map(
          (c) =>
            `A tool was attempted ("${c.tool}") and could not complete it. Technical reason: ${c.reason}`,
        )
        .join("\n")
    : "A tool was attempted and could not complete it. Technical reason: None";

  return `User request: ${userPrompt}\n\n${attemptsSection}`;
};

export const responderOutOfAttemptsHumanPrompt = (
  userPrompt: string,
  corrections: Array<{ tool: string; reason: string }>,
) => {
  const attemptsSection = corrections.length
    ? corrections
        .map((c) => `Attempt: tool "${c.tool}", reason: ${c.reason}`)
        .join("\n")
    : "Attempt: tool None, reason: None";

  return `User request: ${userPrompt}\n\nSeveral approaches were tried without success.\n${attemptsSection}`;
};

export const responderSuccessHumanPrompt = (
  userPrompt: string,
  toolCallHistory: Array<{
    tool: string;
    args: Record<string, unknown>;
    output: string;
  }>,
) => {
  const toolsSection = toolCallHistory
    .map(
      (call, index) =>
        `${index + 1}. Tool used: ${call.tool}\nArguments: ${JSON.stringify(call.args)}\nResult obtained: ${call.output}`,
    )
    .join("\n\n");

  return `User request: ${userPrompt}\n\n${toolsSection}`;
};
