import { and, eq, desc, isNull } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import { chats, type Chat, type NewChat } from "../schema/chats.ts";

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

  async findByRunComparison(
    executionId: number,
    runKey: string,
  ): Promise<ChatRecord | undefined> {
    const [chat] = await this.db
      .select()
      .from(chats)
      .where(and(eq(chats.executionId, executionId), eq(chats.runKey, runKey)))
      .orderBy(desc(chats.updatedAt))
      .limit(1);
    return chat;
  }

  async create(chat: NewChat): Promise<number> {
    const [result] = await this.db
      .insert(chats)
      .values(chat)
      .returning({ id: chats.id });
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
