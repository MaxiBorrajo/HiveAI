import {
  AIMessage,
  type BaseMessage,
  isAIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { TokenSavingsConfig } from "./config.ts";

export function contentChars(content: BaseMessage["content"]): number {
  if (typeof content === "string") return content.length;
  try {
    return JSON.stringify(content).length;
  } catch {
    return 0;
  }
}

export function estimateChars(messages: BaseMessage[]): number {
  let total = 0;
  for (const m of messages) total += contentChars(m.content);
  return total;
}

function toolResultMarker(name: string | undefined, chars: number): string {
  return `[Tool result omitted to save tokens${
    name ? ` (${name})` : ""
  }: ${chars} chars already consumed earlier in this conversation. ` +
    `Call the tool again if you need it.]`;
}

/**
 * Replaces the content of old tool results the model has already consumed
 * (an AI message follows them) with a short marker, keeping the most recent
 * `keepRecentToolResults` complete. `tool_call_id` is preserved so the
 * tool_use/tool_result pairing stays valid. Returns the same array when
 * nothing changes.
 */
export function compactToolResults(
  messages: BaseMessage[],
  cfg: Pick<
    TokenSavingsConfig,
    | "compactionTriggerChars"
    | "compactionMinResultChars"
    | "keepRecentToolResults"
  >,
): BaseMessage[] {
  if (estimateChars(messages) < cfg.compactionTriggerChars) return messages;

  let lastAi = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isAIMessage(messages[i]) || messages[i] instanceof AIMessage) {
      lastAi = i;
      break;
    }
  }

  const consumed: number[] = [];
  for (let i = 0; i < lastAi; i++) {
    if (ToolMessage.isInstance(messages[i])) consumed.push(i);
  }
  const keep = Math.max(0, cfg.keepRecentToolResults);
  const candidates = consumed.slice(
    0,
    Math.max(0, consumed.length - keep),
  );

  let changed = false;
  const out = [...messages];
  for (const i of candidates) {
    const original = messages[i] as ToolMessage;
    const chars = contentChars(original.content);
    if (chars < cfg.compactionMinResultChars) continue;
    out[i] = new ToolMessage({
      content: toolResultMarker(original.name, chars),
      tool_call_id: original.tool_call_id,
      name: original.name,
      status: original.status,
      id: original.id,
    });
    changed = true;
  }
  return changed ? out : messages;
}
