import {
  StateSchema,
  StateGraph,
  MessagesValue,
  type GraphNode,
  START,
  END,
} from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import {
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import z from "zod";
import {
  RESPONDER_SYSTEM_PROMPT,
  SELECTOR_SYSTEM_PROMPT,
} from "./constants.ts";
import { HiveMicrokernel } from "../microkernel/hive-microkernel.ts";

export const HiveAIState = new StateSchema({
  messages: MessagesValue,
  model: z.string(),
});

const HiveQueenResponder: GraphNode<typeof HiveAIState> = async (state) => {
  const responder = new ChatOllama({
    model: state.model, 
    think: true,
    keepAlive: "10m",
    numCtx: 8192,
  });

  const response = await responder.invoke([
    new SystemMessage(RESPONDER_SYSTEM_PROMPT),
    ...state.messages,
  ]);

  return {
    messages: [response],
  };
};

const Selector: GraphNode<typeof HiveAIState> = async (state) => {
  const microkernel = HiveMicrokernel.getInstance();

  const selectorModel = new ChatOllama({
    model: state.model,
    think: true,
    numCtx: 8192,
    keepAlive: "10m",
  });

  const response = await selectorModel
    .bindTools(microkernel.getTools())
    .invoke([new SystemMessage(SELECTOR_SYSTEM_PROMPT), ...state.messages]);

  console.log(
    `Selector decided: [${(response.tool_calls ?? []).map((tc) => tc.name).join(", ") || "none"}]`,
  );

  if (!response.tool_calls?.length) {
    return { messages: [] };
  }

  return { messages: [response] };
};

const Executor: GraphNode<typeof HiveAIState> = async (state) => {
  const lastMessage = state.messages.at(-1);

  if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
    return { messages: [] };
  }

  const microkernel = HiveMicrokernel.getInstance();
  const results: ToolMessage[] = [];

  for (const toolCall of lastMessage.tool_calls ?? []) {
    const tool = microkernel.getTool(toolCall.name);

    if (!tool) {
      results.push(
        new ToolMessage({
          tool_call_id: toolCall.id ?? "",
          name: toolCall.name,
          content: `There is no tool named '${toolCall.name}' in the hive.`,
          status: "error",
        }),
      );
      continue;
    }

    try {
      results.push(await tool.invoke(toolCall));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push(
        new ToolMessage({
          tool_call_id: toolCall.id ?? "",
          name: toolCall.name,
          content: `Tool '${toolCall.name}' failed: ${detail}`,
          status: "error",
        }),
      );
    }
  }

  return { messages: results };
};

const shouldExecute = (state: typeof HiveAIState.State) => {
  const last = state.messages.at(-1);
  return AIMessage.isInstance(last) && last.tool_calls?.length
    ? "Executor"
    : "HiveQueen";
};

export const HiveMind = new StateGraph(HiveAIState)
  .addNode("Selector", Selector)
  .addNode("Executor", Executor)
  .addNode("HiveQueen", HiveQueenResponder)
  .addEdge(START, "Selector")
  .addConditionalEdges("Selector", shouldExecute, ["Executor", "HiveQueen"])
  .addEdge("Executor", "HiveQueen")
  .addEdge("HiveQueen", END)
  .compile();
