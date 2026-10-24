import { eq } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import {
  attachments,
  type Attachment,
  type NewAttachment,
} from "../schema/attachments.ts";

export type { Attachment, NewAttachment };

export class AttachmentRepository {
  constructor(private db: AppDatabase) {}

  async findById(id: number): Promise<Attachment | undefined> {
    const [row] = await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id));
    return row;
  }

  async findByChatId(chatId: number): Promise<Attachment[]> {
    return await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.chatId, chatId));
  }

  async findByExecutionId(executionId: number): Promise<Attachment[]> {
    return await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.executionId, executionId));
  }

  async findByExecutionHistoryId(
    executionHistoryId: number,
  ): Promise<Attachment[]> {
    return await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.executionHistoryId, executionHistoryId));
  }

  async create(row: NewAttachment): Promise<Attachment> {
    const [result] = await this.db.insert(attachments).values(row).returning();
    return result;
  }

  async linkToMessage(id: number, messageId: number): Promise<void> {
    await this.db
      .update(attachments)
      .set({ messageId })
      .where(eq(attachments.id, id));
  }

  async linkToExecutionHistory(
    id: number,
    executionHistoryId: number,
  ): Promise<void> {
    await this.db
      .update(attachments)
      .set({ executionHistoryId })
      .where(eq(attachments.id, id));
  }

  async updateStatus(
    id: number,
    status: Attachment["status"],
  ): Promise<void> {
    await this.db
      .update(attachments)
      .set({ status })
      .where(eq(attachments.id, id));
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(attachments).where(eq(attachments.id, id));
  }
}
