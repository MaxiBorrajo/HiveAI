import {
  StateSchema,
  StateGraph,
  MessagesValue,
  START,
  END,
  ReducedValue,
} from "@langchain/langgraph";
import z from "zod";
import {
  AbstentionVerificator,
  shouldConfirmAbstention,
} from "./abstentionVerificator/node.ts";
import { Diagnostician, shouldRetry } from "./diagnostician/node.ts";
import { Executor, shouldDiagnose } from "./executor/node.ts";
import { HiveQueenResponder } from "./responder/node.ts";
import { shouldRespond, Solver } from "./solver/node.ts";

export const HiveAIState = new StateSchema({
  messages: MessagesValue,
  currentPrompt: z.string(),
  selectorModel: z.string(),
  model: z.string(),
  attempts: new ReducedValue(z.number().default(0), {
    reducer: (x: number, y: number) => x + y,
  }),
  selectionAttempts: new ReducedValue(z.number().default(0), {
    reducer: (x: number, y: number) => x + y,
  }),
  parametrizerAttempts: new ReducedValue(z.number().default(0), {
    reducer: (x: number, y: number) => x + y,
  }),
  abstentionVerified: z.boolean().default(false),
  abstentionChallenged: z.boolean().default(false),
  correction: new ReducedValue(
    z
      .object({
        tool: z.string(),
        reason: z.string(),
        failedArgs: z.record(z.string(), z.unknown()).optional(),
      })
      .nullable()
      .default(null),
    { reducer: (_x, y) => y },
  ),
  selectedTool: z.string(),
  toolResult: z.object({
    ok: z.boolean(),
    output: z.string(),
  }),
  args: z.object({
    params: z.record(z.string(), z.unknown()),
  }),
  giveUp: z.boolean().default(false),
});

export const HiveMind = new StateGraph(HiveAIState)
  .addNode("Solver", Solver)
  .addNode("AbstentionVerificator", AbstentionVerificator)
  .addNode("Executor", Executor)
  .addNode("Diagnostician", Diagnostician)
  .addNode("HiveQueenResponder", HiveQueenResponder)
  .addEdge(START, "Solver")
  .addConditionalEdges("Solver", shouldRespond, [
    "HiveQueenResponder",
    "AbstentionVerificator",
    "Solver",
    "Executor",
  ])
  .addConditionalEdges("AbstentionVerificator", shouldConfirmAbstention, [
    "Solver",
    "HiveQueenResponder",
  ])
  .addConditionalEdges("Executor", shouldDiagnose, [
    "HiveQueenResponder",
    "Diagnostician",
  ])
  .addConditionalEdges("Diagnostician", shouldRetry, [
    "HiveQueenResponder",
    "Solver",
  ])
  .addEdge("HiveQueenResponder", END)
  .compile();
