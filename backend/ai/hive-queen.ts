import {
  StateSchema,
  StateGraph,
  MessagesValue,
  type GraphNode,
  START,
  END,
} from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { SystemMessage } from "@langchain/core/messages";
import z from "zod";
import {
  RESPONDER_SYSTEM_PROMPT,
  SELECTOR_SYSTEM_PROMPT,
} from "./constants.ts";
import { HiveMicrokernel } from "../microkernel/hive-microkernel.ts";
import { tool } from "@langchain/core/tools";

export const HiveAIState = new StateSchema({
  messages: MessagesValue,
  model: z.string(),
  selectedPlugin: z.string(), //pasar a schema
  parameteres: z.json(),
  errors: z.array(z.string()),
  result: z.string(),
});

const HiveQueenResponder: GraphNode<typeof HiveAIState> = async (state) => {
  const responder = new ChatOllama({
    model: state.model,
    think: true,
  });

  const response = await responder.invoke([
    new SystemMessage(RESPONDER_SYSTEM_PROMPT),
    ...state.messages,
  ]);

  return {
    messages: [response],
    model: state.model,
  };
};

const Selector: GraphNode<typeof HiveAIState> = async (state) => {
  const microkernel = HiveMicrokernel.getInstance();
  const plugins = microkernel.getRegisteredPlugins();

  const tools = plugins.map((c) =>
    tool(async (input: unknown) => await c.process(input), {
      name: c.name,
      description: c.description,
      schema: c.schema,
    }),
  );

  const selectorModel = new ChatOllama({
    model: state.model,
    think: false,
    temperature: 0.0,
    numCtx: 8192,
  });

  const modelWithTools = selectorModel.bindTools(tools);

  const response = await modelWithTools.invoke([
    new SystemMessage(SELECTOR_SYSTEM_PROMPT),
    ...state.messages,
  ]);

  return {
    messages: [response],
    model: state.model,
  };
};

const Executor: GraphNode<typeof HiveAIState> = async (state) => {
  const responder = new ChatOllama({
    model: state.model,
    think: true,
  });

  const response = await responder.invoke([
    new SystemMessage(RESPONDER_SYSTEM_PROMPT),
    ...state.messages,
  ]);

  return {
    messages: [response],
    model: state.model,
  };
};

export const HiveMind = new StateGraph(HiveAIState)
  .addNode("Selector", Selector)
  .addEdge(START, "Selector")
  .addEdge("Selector", END)
  .compile();
