import {
  StateSchema,
  StateGraph,
  MessagesValue,
  START,
  END,
  ReducedValue,
} from "@langchain/langgraph";
import z from "zod";
import { HiveMicrokernel } from "../../../microkernel/hive-microkernel.ts";
import {
  AbstentionVerificator,
  shouldConfirmAbstention,
} from "./abstentionVerificator/node.ts";
import { Diagnostician, shouldRetry } from "./diagnostician/node.ts";
import { Executor, shouldDiagnose } from "./executor/node.ts";
import { HiveQueenResponder } from "./responder/node.ts";
import { shouldRespond, Solver } from "./solver/node.ts";

const ChatStepSchema = z.object({
  node: z.enum([
    "Solver",
    "AbstentionVerificator",
    "Executor",
    "Diagnostician",
    "HiveQueenResponder",
    "Plugin",
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
  currentPrompt: z.string(),
  selectorModel: z.string(),
  model: z.string(),
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
});

// Marks the turn as "no tool needed" without ever invoking the Solver —
// used when there are no active plugins, so HiveQueenResponder takes the
// same "answer from general knowledge" path it would take if the Solver
// itself had decided no tool applies.
const NoToolNeeded = () => ({
  selectedTool: "NONE",
  abstentionVerified: true,
});

// Skips the Solver entirely when there are no active plugins to choose
// from — there's nothing for it to decide, so invoking it would just be an
// LLM call that always comes back empty.
const hasActivePlugins = () =>
  HiveMicrokernel.getInstance().getTools().length > 0
    ? "Solver"
    : "NoToolNeeded";

export const HiveMind = new StateGraph(HiveAIState)
  .addNode("Solver", Solver)
  .addNode("NoToolNeeded", NoToolNeeded)
  .addNode("AbstentionVerificator", AbstentionVerificator)
  .addNode("Executor", Executor)
  .addNode("Diagnostician", Diagnostician)
  .addNode("HiveQueenResponder", HiveQueenResponder)
  .addConditionalEdges(START, hasActivePlugins, ["Solver", "NoToolNeeded"])
  .addEdge("NoToolNeeded", "HiveQueenResponder")
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
