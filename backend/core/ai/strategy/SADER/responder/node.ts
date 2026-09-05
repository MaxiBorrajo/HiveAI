import { HumanMessage, SystemMessage } from "@langchain/core/messages";
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

export const HiveQueenResponder: GraphNode<typeof HiveAIState> = async (
  state,
) => {
  const start = performance.now();
  const responder = new ChatOllama({
    model: state.model,
    think: false,
    temperature: 0.0,
    // Caps generation length as a hard safety net: a local/quantized model
    // can occasionally fall into a repetition loop and never emit a natural
    // stop token, which would otherwise stream forever with nothing to cut
    // it off.
    numPredict: 1024,
  });

  const isNoToolNeeded =
    state.selectedTool === "NONE" && state.abstentionVerified;
  const isUnrecoverableFailure = state.giveUp;
  const outOfAttempts = state.attempts > 1;

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

  const response = await responder.invoke([
    new SystemMessage(prompts.systemPrompt),
    new HumanMessage(prompts.humanPrompt),
  ]);

  const durationMs = performance.now() - start;

  return {
    messages: [response],
    steps: [
      {
        node: "HiveQueenResponder" as const,
        label: "Redactando respuesta",
        durationMs,
        summary: String(response.content).replace(/\s+/g, " ").trim().slice(0, 200),
      },
    ],
  };
};
