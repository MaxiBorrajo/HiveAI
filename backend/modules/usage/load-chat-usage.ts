import type { AppDatabase } from "../../infrastructure/db/orm.ts";
import { ModelUsageRepository } from "../../infrastructure/db/repositories/model-usage-repository.ts";
import {
  groupByMessage,
  summarizeConversationUsage,
  summarizeMessageUsage,
} from "./summarize-usage.ts";
import type { ConversationUsage, MessageUsage } from "./types.ts";

export interface ChatUsage {
  // Keyed by message id. A message with no recorded calls is absent.
  byMessage: Map<number, MessageUsage>;
  conversation: ConversationUsage;
}

export async function loadChatUsage(
  db: AppDatabase,
  chatId: number,
): Promise<ChatUsage> {
  const calls = await new ModelUsageRepository(db).listByChat(chatId);

  const byMessage = new Map<number, MessageUsage>();
  for (const [messageId, messageCalls] of groupByMessage(calls)) {
    const summary = summarizeMessageUsage(messageCalls);
    if (summary) byMessage.set(messageId, summary);
  }

  return { byMessage, conversation: summarizeConversationUsage(calls) };
}
