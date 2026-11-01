import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChatModel } from "../../../../core/ai/providers/create-chat-model.ts";
import type { ModelRef } from "../../../../core/ai/providers/types.ts";
import type { LangGraphAbstraction } from "../../../../core/ai/visual-builder/types.ts";

export const MAX_EXECUTION_NAME_LENGTH = 50;

const SYSTEM_PROMPT = `You name workflows. Given the request that produced a workflow and the steps it ended up with, answer with a short title of 2 to 5 words that says what the workflow DOES.
Rules:
- Write it in the same language as the request.
- Title only: no quotes, no trailing punctuation, no prefixes like "Workflow:".
- Do not copy the request; describe the result (e.g. "Resumen de artículos técnicos", "Revisión de estado de git").`;

function describeSteps(graph: LangGraphAbstraction): string {
  return graph.nodes
    .filter((n) => n.type !== "start" && n.type !== "end")
    .map((n) => `- ${n.name} (${n.type})`)
    .join("\n");
}

/** Cleans a model answer into a single short line, or "" if nothing usable. */
export function cleanExecutionName(raw: string): string {
  const firstLine = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const cleaned = firstLine
    .replace(/^(title|t[ií]tulo|name|nombre)\s*:\s*/i, "")
    .replace(/^["'`«“*#\s]+|["'`»”*\s.]+$/g, "")
    .trim();
  if (cleaned.length <= MAX_EXECUTION_NAME_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_EXECUTION_NAME_LENGTH - 1).trimEnd()}…`;
}

/**
 * Asks the orchestrator model for a name that describes the generated flow.
 * Returns undefined on any failure so callers keep the placeholder name.
 */
export async function nameExecutionFromGraph(
  orchestrator: ModelRef,
  prompt: string,
  graph: LangGraphAbstraction,
): Promise<string | undefined> {
  try {
    const model = await createChatModel(orchestrator, { temperature: 0.2 });
    const response = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        `Request:\n${prompt.slice(0, 1000)}\n\nSteps:\n${describeSteps(graph)}`,
      ),
    ]);
    const text = typeof response.content === "string"
      ? response.content
      : response.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
    return cleanExecutionName(text) || undefined;
  } catch (error) {
    console.warn("[Executions Generator] Could not name the flow:", error);
    return undefined;
  }
}
