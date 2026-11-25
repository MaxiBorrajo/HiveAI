import { desc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import {
  chatComparedRuns,
  chats,
  type Chat,
  type NewChat,
} from "../schema/chats.ts";

export type ChatRecord = Chat;
export type { NewChat };

export class ChatRepository {
  constructor(private db: AppDatabase) {}

  async findById(id: number): Promise<ChatRecord | undefined> {
    const [chat] = await this.db.select().from(chats).where(eq(chats.id, id));
    return chat;
  }

  /** The user's chats; the judge chats of run comparisons are left out. */
  async findAll(): Promise<ChatRecord[]> {
    return await this.db
      .select()
      .from(chats)
      .where(isNull(chats.executionId))
      .orderBy(desc(chats.updatedAt));
  }

  /** The judge chat of exactly this set of runs, most recently used first. */
  async findByRunComparison(
    executionId: number,
    historyIds: number[],
  ): Promise<ChatRecord | undefined> {
    const wanted = new Set(historyIds);
    if (wanted.size === 0) return undefined;
    const candidates = await this.db
      .select()
      .from(chats)
      .where(eq(chats.executionId, executionId))
      .orderBy(desc(chats.updatedAt));
    if (candidates.length === 0) return undefined;
    const links = await this.db
      .select()
      .from(chatComparedRuns)
      .where(inArray(chatComparedRuns.chatId, candidates.map((c) => c.id)));
    const byChat = new Map<number, Set<number>>();
    for (const link of links) {
      const set = byChat.get(link.chatId) ?? new Set<number>();
      set.add(link.historyId);
      byChat.set(link.chatId, set);
    }
    return candidates.find((chat) => {
      const have = byChat.get(chat.id);
      return have !== undefined && have.size === wanted.size &&
        [...wanted].every((id) => have.has(id));
    });
  }

  /** `comparedHistoryIds` is set for judge chats: the runs being compared. */
  async create(chat: NewChat, comparedHistoryIds: number[] = []): Promise<number> {
    const [result] = await this.db
      .insert(chats)
      .values(chat)
      .returning({ id: chats.id });
    const unique = [...new Set(comparedHistoryIds)];
    if (unique.length > 0) {
      await this.db.insert(chatComparedRuns).values(
        unique.map((historyId) => ({ chatId: result.id, historyId })),
      );
    }
    return result.id;
  }

  async update(chat: ChatRecord): Promise<void> {
    await this.db
      .update(chats)
      .set({
        title: chat.title,
        updatedAt: chat.updatedAt,
        messageCount: chat.messageCount,
      })
      .where(eq(chats.id, chat.id));
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(chats).where(eq(chats.id, id));
  }
}
