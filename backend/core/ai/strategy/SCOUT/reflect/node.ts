import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { END } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import z from "zod";
import { ScoutState, type ChatStep } from "../graph.ts";
import { parseModelJSON } from "../../shared/utils.ts";
import {
  REFLECT_SYSTEM_PROMPT,
  reflectHumanPrompt,
  REFLECT_RETRY_PROMPT,
} from "./prompt.ts";
import { MAX_AGENT_ITERATIONS, MAX_REFLECTION_ATTEMPTS } from "../constants.ts";

const ReflectResponse = z.object({
  action: z.enum(["accept", "retry"]),
  reason: z.string(),
});

function lastHumanRequest(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (HumanMessage.isInstance(msg)) return String(msg.content);
  }
  return "";
}

export const Reflect: GraphNode<typeof ScoutState> = async (state) => {
  const start = performance.now();

  const lastMessage = state.messages[state.messages.length - 1];
  const draftAnswer = AIMessage.isInstance(lastMessage)
    ? String(lastMessage.content)
    : "";
  const outOfBudget = state.iterations >= MAX_AGENT_ITERATIONS;
  const outOfReflectionAttempts =
    state.reflectionAttempts >= MAX_REFLECTION_ATTEMPTS;

  if (outOfBudget || outOfReflectionAttempts || !draftAnswer) {
    return {
      steps: [
        {
          node: "Reflect" as const,
          label: "Reflecting",
          durationMs: performance.now() - start,
          summary: outOfBudget
            ? "Skipped: out of tool budget"
            : outOfReflectionAttempts
              ? "Skipped: out of reflection attempts"
              : "Skipped: nothing to review",
        } satisfies ChatStep,
      ],
    };
  }

  const userRequest = lastHumanRequest(state.messages);

  const reflectOptions = {
    model: state.model,
    think: true,
    format: z.toJSONSchema(ReflectResponse),
    ...state.modelOptions,
  };
  const reflectModel = new ChatOllama(reflectOptions);

  const response = await reflectModel.invoke([
    new SystemMessage(REFLECT_SYSTEM_PROMPT),
    new HumanMessage(reflectHumanPrompt(userRequest, draftAnswer)),
  ]);

  const parsed = parseModelJSON<{ action: "accept" | "retry"; reason: string }>(
    response.content as string,
    "Reflect",
  );

  const durationMs = performance.now() - start;

  if (!parsed || parsed.action === "accept") {
    return {
      steps: [
        {
          node: "Reflect" as const,
          label: "Reflecting",
          durationMs,
          summary: parsed
            ? `Accepted: ${parsed.reason}`
            : "Uninterpretable response, accepting draft as-is",
        } satisfies ChatStep,
      ],
    };
  }

  return {
    messages: [new HumanMessage(REFLECT_RETRY_PROMPT(parsed.reason))],
    reflectionAttempts: 1,
    steps: [
      {
        node: "Reflect" as const,
        label: "Reflecting",
        durationMs,
        summary: `Sent back for another pass: ${parsed.reason}`,
      } satisfies ChatStep,
    ],
  };
};

export const shouldRetryAfterReflection = (state: typeof ScoutState.State) => {
  const last = state.messages[state.messages.length - 1];
  if (HumanMessage.isInstance(last)) return "Agent";
  return END;
};
