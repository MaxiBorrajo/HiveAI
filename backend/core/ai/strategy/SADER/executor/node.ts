import { ToolMessage } from "@langchain/core/messages/tool";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { GraphNode } from "@langchain/langgraph/web";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { captureSteps } from "../../../../microkernel/step-capture.ts";
import type { HiveAIState, ChatStep } from "../graph.ts";
import { getNativeTool } from "../../shared/native-tools.ts";
import { MAX_TOOL_CHAIN } from "../constants.ts";

function summarize(text: string, maxChars = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxChars
    ? `${oneLine.slice(0, maxChars)}...`
    : oneLine;
}

export const Executor: GraphNode<typeof HiveAIState> = async (state) => {
  if (state.pendingToolCalls.length === 0) {
    return { messages: [] };
  }

  const microkernel = HiveMicrokernel.getInstance();
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

    const tool =
      getNativeTool(toolCall.name, state.chatId) ??
      microkernel.getTool(toolCall.name);

    if (!tool) {
      const output = `There is no tool named '${toolCall.name}' in the hive.`;
      messages.push(
        new ToolMessage({
          tool_call_id: toolCall.id ?? "",
          name: toolCall.name,
          content: output,
          status: "error",
        }),
      );
      toolResults.push({
        tool: toolCall.name,
        args: pending.args,
        ok: false,
        output,
      });
      steps.push({
        node: "Executor",
        label: toolCall.name,
        durationMs: 0,
        summary: "That tool does not exist in the hive",
      });
      continue;
    }

    console.log(
      `\n[SADER - Executor] Preparing to execute tool: "${toolCall.name}"`,
    );
    console.log(
      `[SADER - Executor] Tool Call Payload:`,
      JSON.stringify(toolCall),
    );

    const start = performance.now();

    try {
      const { result: toolResult, steps: pluginSteps } = await captureSteps(
        () => tool.invoke(toolCall),
      );
      const durationMs = performance.now() - start;

      console.log(
        `[SADER - Executor] Execution successful for "${toolCall.name}"`,
      );
      console.log(
        `[SADER - Executor] Output:`,
        summarize(String(toolResult.content)),
      );

      for (const pluginStep of pluginSteps) {
        steps.push({
          node: "Plugin",
          label: toolCall.name,
          durationMs: 0,
          summary: summarize(pluginStep.label),
        });
      }
      steps.push({
        node: "Executor",
        label: toolCall.name,
        durationMs,
        summary: summarize(String(toolResult.content)),
      });

      messages.push(toolResult);
      toolResults.push({
        tool: toolCall.name,
        args: pending.args,
        ok: true,
        output: toolResult.content as string,
      });
      toolCallHistory.push({
        tool: toolCall.name,
        args: pending.args,
        output: toolResult.content as string,
      });
    } catch (error) {
      const durationMs = performance.now() - start;
      const detail = error instanceof Error ? error.message : String(error);

      console.error(
        `\n[SADER - Executor] Execution FAILED for "${toolCall.name}":`,
        detail,
      );

      const output = `Tool '${toolCall.name}' failed: ${detail}`;
      messages.push(
        new ToolMessage({
          tool_call_id: toolCall.id ?? "",
          name: toolCall.name,
          content: output,
          status: "error",
        }),
      );
      toolResults.push({
        tool: toolCall.name,
        args: pending.args,
        ok: false,
        output,
      });
      steps.push({
        node: "Executor" as const,
        label: toolCall.name,
        durationMs,
        summary: `Error: ${detail}`,
      });
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
