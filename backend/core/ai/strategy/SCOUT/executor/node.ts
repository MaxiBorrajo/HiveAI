import { AIMessage } from "@langchain/core/messages";
import { ToolMessage } from "@langchain/core/messages/tool";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { GraphNode } from "@langchain/langgraph/web";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { captureSteps } from "../../../../microkernel/step-capture.ts";
import { ScoutState, type ChatStep } from "../graph.ts";
import { getNativeTool } from "../../shared/native-tools.ts";

function summarize(text: string, maxChars = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxChars
    ? `${oneLine.slice(0, maxChars)}...`
    : oneLine;
}

async function runToolCall(
  toolCall: ToolCall,
  chatId: string,
): Promise<{ message: ToolMessage; steps: ChatStep[]; ok: boolean }> {
  const microkernel = HiveMicrokernel.getInstance();
  const tool =
    getNativeTool(toolCall.name, chatId) ?? microkernel.getTool(toolCall.name);

  if (!tool) {
    return {
      message: new ToolMessage({
        tool_call_id: toolCall.id ?? "",
        name: toolCall.name,
        content: `There is no tool named '${toolCall.name}' in the hive.`,
        status: "error",
      }),
      steps: [
        {
          node: "Executor",
          label: toolCall.name,
          durationMs: 0,
          summary: "That tool does not exist in the hive",
        },
      ],
      ok: false,
    };
  }

  console.log(
    `\n[SCOUT - Executor] Preparing to execute tool: "${toolCall.name}"`,
  );
  console.log(
    `[SCOUT - Executor] Tool Call Payload:`,
    JSON.stringify(toolCall),
  );

  const start = performance.now();

  try {
    const { result: toolResult, steps: pluginSteps } = await captureSteps(() =>
      tool.invoke(toolCall),
    );
    const durationMs = performance.now() - start;

    console.log(
      `[SCOUT - Executor] Execution successful for "${toolCall.name}"`,
    );
    console.log(
      `[SCOUT - Executor] Output:`,
      summarize(String(toolResult.content)),
    );

    const steps: ChatStep[] = pluginSteps.map((pluginStep) => ({
      node: "Plugin",
      label: toolCall.name,
      durationMs: 0,
      summary: summarize(pluginStep.label),
    }));
    steps.push({
      node: "Executor",
      label: toolCall.name,
      durationMs,
      summary: summarize(String(toolResult.content)),
    });

    return { message: toolResult, steps, ok: true };
  } catch (error) {
    const durationMs = performance.now() - start;
    const detail = error instanceof Error ? error.message : String(error);

    console.error(
      `\n[SCOUT - Executor] Execution FAILED for "${toolCall.name}":`,
      detail,
    );

    return {
      message: new ToolMessage({
        tool_call_id: toolCall.id ?? "",
        name: toolCall.name,
        content: `Tool '${toolCall.name}' failed: ${detail}`,
        status: "error",
      }),
      steps: [
        {
          node: "Executor",
          label: toolCall.name,
          durationMs,
          summary: `Error: ${detail}`,
        },
      ],
      ok: false,
    };
  }
}

export const Executor: GraphNode<typeof ScoutState> = async (state) => {
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
    } = await runToolCall(toolCall, state.chatId);
    messages.push(message);
    steps.push(...callSteps);
    if (ok) {
      alreadyExecuted.add(key);
      executedToolCalls.push({ name: toolCall.name, argsKey });
    }
  }

  return { messages, steps, executedToolCalls };
};
