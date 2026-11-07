import { isCloudProvider } from "../providers/types.ts";
import { resolveTokenSavings } from "./config.ts";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";

/**
 * Trims long assistant replies that are not among the `keepRecent` newest
 * messages. Only the copy sent to the model changes; the stored chat is intact.
 */
export function trimOldAssistantMessages(
  messages: BaseMessage[],
  opts: { keepRecent: number; maxChars: number },
): BaseMessage[] {
  const cutoff = messages.length - opts.keepRecent;
  let changed = false;
  const out = messages.map((m, i) => {
    if (
      i >= cutoff || !AIMessage.isInstance(m) || typeof m.content !== "string" ||
      m.content.length <= opts.maxChars
    ) return m;
    changed = true;
    const head = m.content.slice(0, Math.floor(opts.maxChars * 0.7));
    const tail = m.content.slice(-Math.floor(opts.maxChars * 0.2));
    return new AIMessage({
      content: `${head}\n[… ${
        m.content.length - head.length - tail.length
      } chars omitted from this older reply …]\n${tail}`,
      id: m.id,
    });
  });
  return changed ? out : messages;
}

const KEEP_RECENT_MESSAGES = 4;

/** Cloud chats only: local models keep the history exactly as built. */
export function boundHistoryForCloud(
  messages: BaseMessage[],
  provider: string,
): BaseMessage[] {
  try {
    const cfg = resolveTokenSavings();
    if (!cfg.boundedReplay || !isCloudProvider(provider)) return messages;
    return trimOldAssistantMessages(messages, {
      keepRecent: KEEP_RECENT_MESSAGES,
      maxChars: cfg.replayOldMessageMaxChars,
    });
  } catch (error) {
    console.warn("[token-savings] bounded history failed, using full history:", error);
    return messages;
  }
}
