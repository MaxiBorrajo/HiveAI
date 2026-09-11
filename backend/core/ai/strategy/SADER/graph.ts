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

export const ChatStepSchema = z.object({
  node: z.enum([
    "Solver",
    "AbstentionVerificator",
    "Executor",
    "Diagnostician",
    "HiveQueenResponder",
    "Plugin",
    "Agent",
  ]),
  label: z.string(),
  durationMs: z.number(),
  summary: z.string(),
});
export type ChatStep = z.infer<typeof ChatStepSchema>;

const StepsValue = new ReducedValue(z.array(ChatStepSchema).default([]), {
  reducer: (current, next) => [...current, ...next],
});

export const HiveAIState = new StateSchema({
  messages: MessagesValue,
  chatId: z.string(),
  currentPrompt: z.string(),
  selectorModel: z.string(),
  model: z.string(),
  modelOptions: z.record(z.string(), z.unknown()).default({}),
  steps: StepsValue,
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
  chainAttempts: new ReducedValue(z.number().default(0), {
    reducer: (x: number, y: number) => x + y,
  }),
  hasChainedToolResult: z.boolean().default(false),
  toolCallHistory: new ReducedValue(
    z
      .array(
        z.object({
          tool: z.string(),
          args: z.record(z.string(), z.unknown()),
          output: z.string(),
        }),
      )
      .default([]),
    { reducer: (current, next) => [...current, ...next] },
  ),
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
    "Solver",
  ])
  .addConditionalEdges("Diagnostician", shouldRetry, [
    "HiveQueenResponder",
    "Solver",
  ])
  .addEdge("HiveQueenResponder", END)
  .compile();
