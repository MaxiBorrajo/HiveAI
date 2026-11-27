import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  createChatModel,
  resolveAuxiliaryModelRef,
} from "../../../core/ai/providers/create-chat-model.ts";
import type { ModelRef } from "../../../core/ai/providers/types.ts";
import { TASK_TYPES, type TaskType } from "../types.ts";

export interface TaskSignals {
  text: string;
  /** The user attached an image */
  hasImage?: boolean;
  /** The user attached a document (PDF, spreadsheet, text file) */
  hasDocument?: boolean;
}

export interface ClassifiedTask {
  task: TaskType;
  source: "heuristic" | "llm";
}

/** Below this length with no clear signal, the message is not worth a model call. */
export const MIN_LENGTH_FOR_LLM = 60;
const MAX_TEXT_FOR_LLM = 2000;

interface Rule {
  task: TaskType;
  pattern: RegExp;
  weight: number;
}

// Spanish and English. Weights: a strong, unambiguous term counts 2, a hint counts 1.
const RULES: Rule[] = [
  { task: "code", pattern: /```/, weight: 3 },
  {
    task: "code",
    pattern:
      /\b(stack ?trace|traceback|exception|refactor\w*|debug\w*|compil\w+|typescript|javascript|python|rust|golang|java|c\+\+|sql|regex|endpoint|unit tests?|pull request)\b/i,
    weight: 2,
  },
  {
    task: "code",
    pattern:
      /\b(function|class|bug|script|c[oó]digo|code|funci[oó]n|programa|error|api|variable|m[eé]todo|clase)\b/i,
    weight: 1,
  },
  {
    task: "summarization",
    pattern: /\b(resum\w*|summari[sz]\w*|summary|tl;?dr|sintetiz\w*|condens\w*)\b/i,
    weight: 3,
  },
  {
    task: "documents_data",
    pattern: /\b(csv|excel|xlsx|spreadsheet|planilla|dataset|pdf)\b/i,
    weight: 2,
  },
  {
    task: "documents_data",
    pattern: /\b(tabla|datos|data|documento|document|informe|report|analiz\w+|analy[sz]\w+|columnas?|columns?)\b/i,
    weight: 1,
  },
  {
    task: "reasoning",
    pattern:
      /\b(demuestra|demostrar|prove|proof|acertijo|puzzle|paso a paso|step[- ]by[- ]step|razon\w+|reason through|matem[aá]tic\w*|optimi[zs]\w+)\b/i,
    weight: 2,
  },
  {
    task: "reasoning",
    pattern: /\b(l[oó]gic\w*|logic|calcul\w+|estrategia|strategy|trade-?offs?)\b/i,
    weight: 1,
  },
];

/**
 * Free, instant guess from the message and its attachments. Returns null when
 * there is no clear signal, in which case a small model may decide.
 */
export function classifyByHeuristics(signals: TaskSignals): TaskType | null {
  if (signals.hasImage) return "vision";

  const scores = new Map<TaskType, number>();
  const add = (task: TaskType, weight: number) => scores.set(task, (scores.get(task) ?? 0) + weight);
  if (signals.hasDocument) add("documents_data", 2);
  for (const rule of RULES) if (rule.pattern.test(signals.text)) add(rule.task, rule.weight);

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [best, runnerUp] = ranked;
  // needs real evidence and a clear winner
  if (!best || best[1] < 2) return null;
  if (runnerUp && runnerUp[1] === best[1]) return null;
  return best[0];
}

const TaskSchema = z.object({
  task: z.enum(TASK_TYPES).describe("The kind of task the user is asking for"),
});

const SYSTEM_PROMPT = `Classify what the user is asking an AI assistant to do into exactly one task type:
- chat: casual conversation, general questions, advice, writing help
- code: writing, fixing, explaining or reviewing code
- summarization: summarizing or condensing text
- documents_data: analyzing documents, tables, spreadsheets or data
- reasoning: hard multi-step reasoning, math, logic, planning, complex trade-offs
- vision: understanding or describing images
- tools: the user wants the assistant to DO something with external tools (search the web, read or write files, call services)
Answer with the single best task type.`;

/** One cheap structured call to the provider's small model. Null on any failure. */
export async function classifyWithSmallModel(
  text: string,
  ref: ModelRef,
): Promise<TaskType | null> {
  try {
    const model = (await createChatModel(await resolveAuxiliaryModelRef(ref), {
      temperature: 0,
      think: false,
    })).withStructuredOutput(TaskSchema, { name: "TaskClassification" });
    const result = (await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(text.slice(0, MAX_TEXT_FOR_LLM)),
    ])) as z.infer<typeof TaskSchema>;
    return (TASK_TYPES as readonly string[]).includes(result?.task) ? result.task : null;
  } catch (error) {
    console.warn(
      "[Model suggestion] Task classification failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export interface ClassifyDeps {
  llm: (text: string, ref: ModelRef) => Promise<TaskType | null>;
}

/** Heuristics first; the small model only when they found nothing and the message is long enough to matter. */
export async function classifyTask(
  signals: TaskSignals,
  ref: ModelRef,
  deps: ClassifyDeps = { llm: classifyWithSmallModel },
): Promise<ClassifiedTask | null> {
  const guess = classifyByHeuristics(signals);
  if (guess) return { task: guess, source: "heuristic" };
  if (signals.text.trim().length < MIN_LENGTH_FOR_LLM) return null;
  const task = await deps.llm(signals.text, ref);
  return task ? { task, source: "llm" } : null;
}
