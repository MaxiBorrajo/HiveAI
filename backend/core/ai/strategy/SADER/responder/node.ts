import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { HiveAIState } from "../graph.ts";
import { ChatOllama } from "@langchain/ollama";
import {
  RESPONDER_FAILURE_SYSTEM_PROMPT,
  RESPONDER_NO_TOOL_SYSTEM_PROMPT,
  RESPONDER_OUT_OF_ATTEMPTS_SYSTEM_PROMPT,
  RESPONDER_SUCCESS_SYSTEM_PROMPT,
  responderFailureHumanPrompt,
  responderOutOfAttemptsHumanPrompt,
  responderSuccessHumanPrompt,
} from "./prompt.ts";
import { MAX_ATTEMPTS } from "../constants.ts";

export const HiveQueenResponder: GraphNode<typeof HiveAIState> = async (
  state,
) => {
  const start = performance.now();
  const responderOptions = {
    model: state.model,
    think: false,
    temperature: 0.0,
    numPredict: 1024,
    ...state.modelOptions,
  };
  const responder = new ChatOllama(responderOptions);

  console.log(`[SADER - Responder] Effective Ollama options:`, responderOptions);

  const isNoToolNeeded =
    state.selectedTool === "NONE" && state.abstentionVerified;
  const isUnrecoverableFailure = state.giveUp;
  const outOfAttempts = state.attempts > MAX_ATTEMPTS;

  const prompts = isNoToolNeeded
    ? {
        humanPrompt: state.currentPrompt,
        systemPrompt: RESPONDER_NO_TOOL_SYSTEM_PROMPT,
      }
    : isUnrecoverableFailure
      ? {
          humanPrompt: responderFailureHumanPrompt(
            state.currentPrompt,
            state.correction?.tool ?? "None",
            state.correction?.reason ?? "None",
          ),
          systemPrompt: RESPONDER_FAILURE_SYSTEM_PROMPT,
        }
      : outOfAttempts
        ? {
            humanPrompt: responderOutOfAttemptsHumanPrompt(
              state.currentPrompt,
              state.correction?.tool ?? "None",
              state.correction?.reason ?? "None",
            ),
            systemPrompt: RESPONDER_OUT_OF_ATTEMPTS_SYSTEM_PROMPT,
          }
        : {
            humanPrompt: responderSuccessHumanPrompt(
              state.currentPrompt,
              state.selectedTool,
              state.args.params,
              state.toolResult.output,
            ),
            systemPrompt: RESPONDER_SUCCESS_SYSTEM_PROMPT,
          };

  console.log(`\n[SADER - Responder] Starting response generation`);
  console.log(
    `[SADER - Responder] State: noTool=${isNoToolNeeded}, giveUp=${isUnrecoverableFailure}, outOfAttempts=${outOfAttempts}`,
  );

  const response = await responder.invoke([
    new SystemMessage(prompts.systemPrompt),
    new HumanMessage(prompts.humanPrompt),
  ]);

  console.log(
    `[SADER - Responder] Final answer output:`,
    String(response.content).substring(0, 150) + "...",
  );

  const durationMs = performance.now() - start;
  const outputTokens = (response as AIMessage).usage_metadata?.output_tokens ?? 0;
  const tokensPerSecond =
    durationMs > 0 && outputTokens > 0
      ? Number(((outputTokens / durationMs) * 1000).toFixed(1))
      : 0;

  console.log(
    `[SADER - Responder] ${outputTokens} output tokens in ${durationMs.toFixed(0)}ms (${tokensPerSecond} tok/s)`,
  );

  return {
    messages: [response],
    steps: [
      {
        node: "HiveQueenResponder" as const,
        label: "Drafting response",
        durationMs,
        summary: String(response.content)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200),
      },
    ],
  };
};
