import { AIMessage } from "@langchain/core/messages";
import { ToolMessage } from "@langchain/core/messages/tool";
import type { GraphNode } from "@langchain/langgraph/web";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { captureSteps } from "../../../../microkernel/step-capture.ts";
import type { HiveAIState, ChatStep } from "../graph.ts";

// Truncates a plugin-reported step label to a single log-friendly line — a
// misbehaving plugin could otherwise report unbounded text into the step log.
function summarize(text: string, maxChars = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxChars ? `${oneLine.slice(0, maxChars)}...` : oneLine;
}

export const Executor: GraphNode<typeof HiveAIState> = async (state) => {
  const lastMessage = [...state.messages]
    .reverse()
    .find((m) => AIMessage.isInstance(m) && m.tool_calls?.length);

  if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
    return { messages: [] };
  }

  const microkernel = HiveMicrokernel.getInstance();

  const toolCall = lastMessage.tool_calls?.[0];

  if (!toolCall) {
    return {
      messages: [
        new ToolMessage({
          tool_call_id: "",
          name: state.selectedTool,
          content: `There is no tool named '${state.selectedTool}' in the hive.`,
          status: "error",
        }),
      ],
      toolResult: {
        ok: false,
        output: `There is no tool named '${state.selectedTool}' in the hive.`,
      },
    };
  }

  const tool = microkernel.getTool(toolCall.name);

  if (!tool) {
    return {
      messages: [
        new ToolMessage({
          tool_call_id: "",
          name: state.selectedTool,
          content: `There is no tool named '${state.selectedTool}' in the hive.`,
          status: "error",
        }),
      ],
      toolResult: {
        ok: false,
        output: `There is no tool named '${state.selectedTool}' in the hive.`,
      },
      steps: [
        {
          node: "Executor" as const,
          label: state.selectedTool,
          durationMs: 0,
          summary: "That tool does not exist in the hive",
        },
      ],
    };
  }

  console.log(JSON.stringify(toolCall));

  const start = performance.now();

  try {
    const { result: toolResult, steps: pluginSteps } = await captureSteps(() =>
      tool.invoke(toolCall),
    );
    const durationMs = performance.now() - start;

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

    return {
      messages: [toolResult],
      toolResult: {
        ok: true,
        output: toolResult.content as string,
      },
      steps,
    };
  } catch (error) {
    const durationMs = performance.now() - start;
    const detail = error instanceof Error ? error.message : String(error);
    return {
      messages: [
        new ToolMessage({
          tool_call_id: toolCall.id ?? "",
          name: toolCall.name,
          content: `Tool '${toolCall.name}' failed: ${detail}`,
          status: "error",
        }),
      ],
      toolResult: {
        ok: false,
        output: `Tool '${toolCall.name}' failed: ${detail}`,
      },
      steps: [
        {
          node: "Executor" as const,
          label: toolCall.name,
          durationMs,
          summary: `Error: ${detail}`,
        },
      ],
    };
  }
};

export const shouldDiagnose = (state: typeof HiveAIState.State) => {
  return state.toolResult.ok ? "HiveQueenResponder" : "Diagnostician";
};
