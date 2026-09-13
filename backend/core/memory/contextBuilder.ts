import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { embedText } from "./embeddings.ts";
import { getRecentMessages, hybridSearchInChat } from "./messageStore.ts";
import type { MessageRecord } from "./types.ts";

export const RECENCY_WINDOW = 10;
export const RELEVANCE_TOPK = 6;

function toBaseMessage(record: MessageRecord): BaseMessage {
  return record.role === "user"
    ? new HumanMessage(record.content)
    : new AIMessage(record.content);
}

export async function buildTurnContext(
  dataDir: string,
  chatId: string,
  userText: string,
): Promise<BaseMessage[]> {
  const [recent, queryVector] = await Promise.all([
    getRecentMessages(dataDir, chatId, RECENCY_WINDOW),
    embedText(userText),
  ]);

  const relevant = await hybridSearchInChat(
    dataDir,
    chatId,
    userText,
    queryVector,
    RELEVANCE_TOPK,
  );

  const byId = new Map<string, MessageRecord>();
  for (const record of [...recent, ...relevant]) {
    byId.set(record.id, record);
  }

  const merged = Array.from(byId.values()).sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  return merged.map(toBaseMessage);
}
