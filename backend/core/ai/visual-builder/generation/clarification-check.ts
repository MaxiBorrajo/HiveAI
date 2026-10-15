import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createChatModel } from "../../providers/create-chat-model.ts";
import type { ModelRef } from "../../providers/types.ts";
import type { LangGraphAbstraction, PluginInfo } from "../types.ts";
import { invokeWithRetry } from "./generation-step.ts";
import { describeExistingGraph } from "./topology-compiler.ts";

const MAX_QUESTIONS = 3;

const ClarificationSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe("One short, direct question for the user"),
        options: z
          .array(z.string())
          .max(4)
          .optional()
          .describe(
            "2-4 plausible answers the user can pick from. Omit when the answer is free text.",
          ),
      }),
    )
    .max(MAX_QUESTIONS)
    .describe(
      "Questions that MUST be answered before designing the workflow. Return an empty array when the request is clear enough.",
    ),
});

export interface ClarifyingQuestion {
  question: string;
  options?: string[];
}

export async function findClarifyingQuestions(
  prompt: string,
  availablePlugins: PluginInfo[],
  orchestrator: ModelRef,
  existingGraph?: LangGraphAbstraction,
): Promise<ClarifyingQuestion[]> {
  try {
    const checker = (await createChatModel(orchestrator, { temperature: 0, think: false }))
      .withStructuredOutput(ClarificationSchema, { name: "ClarificationCheck" });

    const system = `You decide whether a request to build or change an automation workflow is missing information that is ESSENTIAL to design it.
Available plugins: ${availablePlugins.map((p) => p.name).join(", ") || "none"}.
${existingGraph ? `The workflow already exists:\n${describeExistingGraph(existingGraph)}\n` : ""}
Rules:
- Default to NO questions. Most requests are clear enough: make sensible assumptions instead of asking.
- Ask only when the answer would change the structure of the workflow and cannot be reasonably inferred (e.g. where the result must be saved when several options are plausible, which data source to use, a required topic or target that is not stated at all).
- DO ask when the request leaves undefined WHAT the workflow works on or produces (e.g. "save the result to a file" without saying what the data or content is, or "analyze it" without saying what "it" is).
- Never ask about things the workflow can decide itself, about formatting preferences, or about details a node can figure out at run time.
- At most ${MAX_QUESTIONS} questions, each short and answerable in one line. Offer options when the valid answers are a small known set.
- Write the questions in the same language as the request.`;

    const result = (await invokeWithRetry(
      checker,
      [new SystemMessage(system), new HumanMessage(prompt)],
      "Clarification Check",
    )) as z.infer<typeof ClarificationSchema>;

    return (result.questions ?? [])
      .filter((q) => q.question.trim())
      .slice(0, MAX_QUESTIONS);
  } catch (error) {
    console.warn(
      "[Visual Builder - Generator] Clarification check failed, continuing without questions:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}
