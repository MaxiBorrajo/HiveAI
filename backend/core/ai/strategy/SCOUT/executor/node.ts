import { AIMessage } from "@langchain/core/messages";
import { ToolMessage } from "@langchain/core/messages/tool";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { GraphNode } from "@langchain/langgraph/web";
import { ScoutState, type ChatStep } from "../graph.ts";
import { runToolCall } from "../../shared/run-tool-call.ts";

export const Executor: GraphNode<typeof ScoutState> = async (
  state,
  config,
) => {
  const lastMessage = state.messages[state.messages.length - 1];

  if (!AIMessage.isInstance(lastMessage) || !lastMessage.tool_calls?.length) {
    return { messages: [] };
  }

  const messages: ToolMessage[] = [];
  const steps: ChatStep[] = [];
  const executedToolCalls: { name: string; argsKey: string }[] = [];
  const alreadyExecuted = new Set(
    state.executedToolCalls.map((call) => `${call.name}:${call.argsKey}`),
  );

  for (const toolCall of lastMessage.tool_calls) {
    const argsKey = JSON.stringify(toolCall.args ?? {});
    const key = `${toolCall.name}:${argsKey}`;

    if (alreadyExecuted.has(key)) {
      console.warn(
        `[SCOUT - Executor] Refusing to repeat identical call to "${toolCall.name}" with the same arguments.`,
      );
      messages.push(
        new ToolMessage({
          tool_call_id: toolCall.id ?? "",
          name: toolCall.name,
          content: `This exact call to '${toolCall.name}' with the same arguments already ran successfully earlier in this turn — it was NOT run again, to avoid repeating a real action. If the task is already done, answer the user now instead of calling this again.`,
          status: "error",
        }),
      );
      steps.push({
        node: "Executor",
        label: toolCall.name,
        durationMs: 0,
        summary: "Skipped: identical call already executed this turn",
      });
      continue;
    }

    const {
      message,
      steps: callSteps,
      ok,
    } = await runToolCall(toolCall, state.chatId, config.signal, "SCOUT");
    messages.push(message);
    steps.push(...callSteps);
    if (ok) {
      alreadyExecuted.add(key);
      executedToolCalls.push({ name: toolCall.name, argsKey });
    }
  }

  return { messages, steps, executedToolCalls };
};
