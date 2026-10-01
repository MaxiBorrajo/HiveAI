import type { ToolMessage } from "@langchain/core/messages/tool";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { GraphNode } from "@langchain/langgraph/web";
import type { HiveAIState, ChatStep } from "../graph.ts";
import { runToolCall } from "../../shared/run-tool-call.ts";
import { MAX_TOOL_CHAIN } from "../constants.ts";

export const Executor: GraphNode<typeof HiveAIState> = async (state) => {
  if (state.pendingToolCalls.length === 0) {
    return { messages: [] };
  }

  const messages: ToolMessage[] = [];
  const steps: ChatStep[] = [];
  const toolResults: {
    tool: string;
    args: Record<string, unknown>;
    ok: boolean;
    output: string;
  }[] = [];
  const toolCallHistory: {
    tool: string;
    args: Record<string, unknown>;
    output: string;
  }[] = [];

  for (const pending of state.pendingToolCalls) {
    const toolCall: ToolCall = {
      id: crypto.randomUUID(),
      name: pending.tool,
      args: pending.args,
      type: "tool_call",
    };

    const { message, steps: callSteps, ok } = await runToolCall(
      toolCall,
      state.chatId,
      undefined,
      "SADER",
    );
    const output = message.content as string;

    messages.push(message);
    steps.push(...callSteps);
    toolResults.push({ tool: toolCall.name, args: pending.args, ok, output });
    if (ok) {
      toolCallHistory.push({ tool: toolCall.name, args: pending.args, output });
    }
  }

  return {
    messages,
    toolResults,
    toolCallHistory,
    chainAttempts: 1,
    hasChainedToolResult: true,
    steps,
  };
};

export const shouldDiagnose = (state: typeof HiveAIState.State) => {
  if (state.toolResults.some((r) => !r.ok)) return "Diagnostician";
  if (state.chainAttempts < MAX_TOOL_CHAIN) return "Solver";
  return "HiveQueenResponder";
};
