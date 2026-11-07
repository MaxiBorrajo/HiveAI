import {
  type BaseMessage,
  HumanMessage,
  isAIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { TokenSavingsConfig } from "./config.ts";
import { contentChars, estimateChars } from "./deterministic-compaction.ts";
import { notifyCompaction } from "./notice.ts";

/** Returns a summary of `text`, or throws. Built lazily by the factory. */
export type Summarizer = (text: string) => Promise<string>;
export type SummarizerProvider = () => Promise<Summarizer | undefined>;

interface SummaryLlm {
  invoke(
    prompt: string,
    config?: { callbacks: never[] },
  ): Promise<{ content: string | { type: string; text?: string }[] }>;
}

/**
 * Builds the summarizer on top of a chat model. The call runs inside the
 * caller's graph run, so without an explicit empty `callbacks` it would
 * inherit the graph's callbacks and its tokens would be streamed to the user
 * as if they were part of the answer. Callbacks set on the model itself (usage
 * recording) still apply.
 */
export function summarizerFromModel(llm: SummaryLlm): Summarizer {
  return async (prompt) => {
    const res = await llm.invoke(prompt, { callbacks: [] });
    return typeof res.content === "string" ? res.content : res.content
      .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
      .join("");
  };
}

const SUMMARY_PROMPT =
  "Summarize the conversation below so an assistant can continue it without " +
  "re-reading it. Keep decisions, user preferences, concrete facts, names, " +
  "paths, numbers and open questions. Drop pleasantries and repetition. " +
  "Reply with the summary only, in the conversation's language, under 400 words.";

const MAX_SUMMARIZER_INPUT_CHARS = 60_000;
const MAX_TOOL_CHARS_IN_TRANSCRIPT = 500;
const CACHE_LIMIT = 50;

const summaryCache = new Map<string, string>();

export function clearSummaryCache(): void {
  summaryCache.clear();
}

function render(messages: BaseMessage[]): string {
  const lines = messages.map((m) => {
    const raw = typeof m.content === "string"
      ? m.content
      : JSON.stringify(m.content);
    const isTool = ToolMessage.isInstance(m);
    const text = isTool && raw.length > MAX_TOOL_CHARS_IN_TRANSCRIPT
      ? raw.slice(0, MAX_TOOL_CHARS_IN_TRANSCRIPT) + "…"
      : raw;
    const role = isTool ? "tool" : isAIMessage(m) ? "assistant" : "user";
    return `${role}: ${text}`;
  });
  const joined = lines.join("\n\n");
  if (joined.length <= MAX_SUMMARIZER_INPUT_CHARS) return joined;
  const half = MAX_SUMMARIZER_INPUT_CHARS / 2;
  return joined.slice(0, half) + "\n…\n" + joined.slice(-half);
}

async function hash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function withSummary(human: BaseMessage, summary: string): HumanMessage {
  const header = `[Summary of the earlier conversation]\n${summary}\n\n[Current request]\n`;
  const content = typeof human.content === "string"
    ? header + human.content
    : [{ type: "text" as const, text: header }, ...human.content];
  return new HumanMessage({
    content,
    additional_kwargs: human.additional_kwargs,
    id: human.id,
  });
}

/**
 * Replaces the history that precedes the current turn's user message with a
 * summary, folded into that message so role ordering stays valid. Returns the
 * same array when the history is small, there is no summarizer, or anything
 * fails.
 */
export async function summarizeHistory(
  messages: BaseMessage[],
  cfg: Pick<TokenSavingsConfig, "summaryTriggerChars" | "summaryMinHistoryChars">,
  getSummarizer: SummarizerProvider,
): Promise<BaseMessage[]> {
  if (estimateChars(messages) < cfg.summaryTriggerChars) return messages;

  let systemEnd = 0;
  while (
    systemEnd < messages.length && SystemMessage.isInstance(messages[systemEnd])
  ) systemEnd++;

  let lastHuman = -1;
  for (let i = messages.length - 1; i >= systemEnd; i--) {
    if (HumanMessage.isInstance(messages[i])) {
      lastHuman = i;
      break;
    }
  }
  if (lastHuman <= systemEnd) return messages;

  const older = messages.slice(systemEnd, lastHuman);
  const olderChars = older.reduce((n, m) => n + contentChars(m.content), 0);
  if (olderChars < cfg.summaryMinHistoryChars) return messages;

  const transcript = render(older);
  const key = await hash(transcript);
  let summary = summaryCache.get(key);

  if (!summary) {
    const started = Date.now();
    const summarize = await getSummarizer();
    if (!summarize) return messages;
    summary = (await summarize(`${SUMMARY_PROMPT}\n\n---\n${transcript}`)).trim();
    if (!summary) return messages;
    if (summaryCache.size >= CACHE_LIMIT) {
      summaryCache.delete(summaryCache.keys().next().value as string);
    }
    summaryCache.set(key, summary);

    const out = [
      ...messages.slice(0, systemEnd),
      withSummary(messages[lastHuman], summary),
      ...messages.slice(lastHuman + 1),
    ];
    notifyCompaction({
      kind: "llm-summary",
      beforeChars: estimateChars(messages),
      afterChars: estimateChars(out),
      durationMs: Date.now() - started,
    });
    return out;
  }

  return [
    ...messages.slice(0, systemEnd),
    withSummary(messages[lastHuman], summary),
    ...messages.slice(lastHuman + 1),
  ];
}
