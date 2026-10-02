import { ToolMessage } from "@langchain/core/messages/tool";
import type { ToolCall } from "@langchain/core/messages/tool";
import { HiveMicrokernel } from "../../../microkernel/hive-microkernel.ts";
import { captureSteps } from "../../../microkernel/step-capture.ts";
import type { ChatStep } from "./chat-step.ts";
import { getNativeTool } from "./native-tools.ts";

export function summarize(text: string, maxChars = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxChars
    ? `${oneLine.slice(0, maxChars)}...`
    : oneLine;
}

export async function runToolCall(
  toolCall: ToolCall,
  chatId: string | number,
  signal: AbortSignal | undefined,
  strategy: string,
): Promise<{ message: ToolMessage; steps: ChatStep[]; ok: boolean }> {
  const microkernel = HiveMicrokernel.getInstance();
  const tool =
    getNativeTool(toolCall.name, chatId) ??
    microkernel.getTool(toolCall.name);

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
    `\n[${strategy} - Executor] Preparing to execute tool: "${toolCall.name}"`,
  );
  console.log(
    `[${strategy} - Executor] Tool Call Payload:`,
    JSON.stringify(toolCall),
  );

  const start = performance.now();

  try {
    const { result: toolResult, steps: pluginSteps } = await captureSteps(() =>
      tool.invoke(toolCall, { signal }),
    );
    const durationMs = performance.now() - start;

    console.log(
      `[${strategy} - Executor] Execution successful for "${toolCall.name}"`,
    );
    console.log(
      `[${strategy} - Executor] Output:`,
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
      `\n[${strategy} - Executor] Execution FAILED for "${toolCall.name}":`,
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
