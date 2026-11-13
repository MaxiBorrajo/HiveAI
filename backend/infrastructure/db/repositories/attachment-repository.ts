import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import { isImageMimeType } from "../../../core/attachments/attachment-limits.ts";
import type { ScanState } from "../../../core/attachments/scanned-content.ts";
import {
  attachmentChunks,
  attachments,
  type Attachment,
  type AttachmentChunk,
  type NewAttachment,
} from "../schema/attachments.ts";

export type { Attachment, AttachmentChunk, NewAttachment };

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

  /**
   * Also sets the chat: a file attached before the chat exists is uploaded
   * without one, and the chat's history looks attachments up by chat id.
   */
  async linkToMessage(
    id: number,
    messageId: number,
    chatId: number,
  ): Promise<void> {
    await this.db
      .update(attachments)
      .set({ messageId, chatId })
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

  async findUnindexedChatIds(chatId: number): Promise<number[]> {
    const rows = await this.db
      .select({ id: attachments.id, mimeType: attachments.mimeType })
      .from(attachments)
      .where(and(eq(attachments.chatId, chatId), isNull(attachments.indexedAt)));
    return rows.filter((r) => !isImageMimeType(r.mimeType)).map((r) => r.id);
  }

  async countChunks(attachmentId: number): Promise<number> {
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(attachmentChunks)
      .where(eq(attachmentChunks.attachmentId, attachmentId));
    return total;
  }

  async addChunk(chunk: AttachmentChunk): Promise<void> {
    await this.db.insert(attachmentChunks).values(chunk);
  }

  async updateScan(id: number, scan: ScanState): Promise<void> {
    await this.db
      .update(attachments)
      .set({ scan })
      .where(eq(attachments.id, id));
  }

  /** Drops the file's search index so it is built again from its text. */
  async resetIndex(id: number): Promise<void> {
    await this.db
      .delete(attachmentChunks)
      .where(eq(attachmentChunks.attachmentId, id));
    await this.db
      .update(attachments)
      .set({ indexedAt: null })
      .where(eq(attachments.id, id));
  }

  async markIndexed(id: number, indexedAt: number): Promise<void> {
    await this.db
      .update(attachments)
      .set({ indexedAt })
      .where(eq(attachments.id, id));
  }

  async findChunks(attachmentIds: number[]): Promise<AttachmentChunk[]> {
    if (attachmentIds.length === 0) return [];
    return await this.db
      .select()
      .from(attachmentChunks)
      .where(inArray(attachmentChunks.attachmentId, attachmentIds));
  }

  copyChunks(fromAttachmentId: number, toAttachmentId: number): void {
    this.db.$client
      .prepare(
        `INSERT INTO attachment_chunks (attachmentId, chunkIndex, startChar, text, vector)
         SELECT ?, chunkIndex, startChar, text, vector
         FROM attachment_chunks WHERE attachmentId = ?`,
      )
      .run(toAttachmentId, fromAttachmentId);
  }
}
