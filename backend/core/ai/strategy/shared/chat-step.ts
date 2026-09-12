import z from "zod";

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
