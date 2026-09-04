import { AIMessage } from "@langchain/core/messages";
import { ToolMessage } from "@langchain/core/messages/tool";
import type { GraphNode } from "@langchain/langgraph/web";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import type { HiveAIState } from "../graph.ts";

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
    };
  }

  console.log(JSON.stringify(toolCall));

  try {
    const toolResult = await tool.invoke(toolCall);
    return {
      messages: [toolResult],
      toolResult: {
        ok: true,
        output: toolResult.content as string,
      },
    };
  } catch (error) {
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
    };
  }
};

export const shouldDiagnose = (state: typeof HiveAIState.State) => {
  return state.toolResult.ok ? "HiveQueenResponder" : "Diagnostician";
};
