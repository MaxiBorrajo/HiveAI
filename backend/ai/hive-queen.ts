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
import { HIVE_QUEEN_SYSTEM_PROMPT } from "./constants.ts";

export const HiveAIState = new StateSchema({
  messages: MessagesValue,
  model: z.string(),
  selectedPlugin: z.string(), //pasar a schema
  parameteres: z.json(),
  errors: z.array(z.string()),
  result: z.string(),
});

const HiveQueen: GraphNode<typeof HiveAIState> = async (state) => {
  const responder = new ChatOllama({
    model: state.model,
    think: true,
  });

  const response = await responder.invoke([
    new SystemMessage(HIVE_QUEEN_SYSTEM_PROMPT),
    ...state.messages,
  ]);

  return {
    messages: [response],
    model: state.model,
  };
};

const Selector: GraphNode<typeof HiveAIState> = async (state) => {
  return {
  };
};

const Parameterizer: GraphNode<typeof HiveAIState> = async (state) => {
 
  return {
  };
};

const Validator: GraphNode<typeof HiveAIState> = async (state) => {
 

  return {
  };
};

const Executor: GraphNode<typeof HiveAIState> = async (state) => {


  return {
  };
};

export const HiveMind = new StateGraph(HiveAIState)
  .addNode("HiveQueen", HiveQueen)
  .addEdge(START, "HiveQueen")
  .addEdge("HiveQueen", END)
  .compile();
