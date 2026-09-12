import {
  StateSchema,
  StateGraph,
  MessagesValue,
  START,
  END,
  ReducedValue,
} from "@langchain/langgraph";
import z from "zod";
import { ChatStepSchema, type ChatStep } from "../shared/chat-step.ts";
import { Agent, shouldContinue } from "./agent/node.ts";
import { Executor } from "./executor/node.ts";

export type { ChatStep };

const StepsValue = new ReducedValue(z.array(ChatStepSchema).default([]), {
  reducer: (current, next) => [...current, ...next],
});

export const ScoutState = new StateSchema({
  messages: MessagesValue,
  chatId: z.string(),
  model: z.string(),
  modelOptions: z.record(z.string(), z.unknown()).default({}),
  steps: StepsValue,
  iterations: new ReducedValue(z.number().default(0), {
    reducer: (x: number, y: number) => x + y,
  }),
  turnStartedAt: new ReducedValue(z.number().default(0), {
    reducer: (current, next) => current || next,
  }),
  executedToolCalls: new ReducedValue(
    z.array(z.object({ name: z.string(), argsKey: z.string() })).default([]),
    { reducer: (current, next) => [...current, ...next] },
  ),
});

export const Scout = new StateGraph(ScoutState)
  .addNode("Agent", Agent)
  .addNode("Executor", Executor)
  .addEdge(START, "Agent")
  .addConditionalEdges("Agent", shouldContinue, ["Executor", END])
  .addEdge("Executor", "Agent")
  .compile();
