import {
  AttachmentRepository,
  type Attachment,
} from "../../infrastructure/db/repositories/attachment-repository.ts";
import { copyAttachmentFile } from "./attachment-storage.ts";

/**
 * Copies an attachment's files, row and search index under a new owner, so
 * the copy can be linked and deleted without touching the original.
 */
export async function duplicateAttachment(
  dataDir: string,
  repo: AttachmentRepository,
  attachment: Attachment,
  owner: { chatId: number; messageId: number },
  createdAt: number = Date.now(),
): Promise<Attachment> {
  const storagePath = await copyAttachmentFile(dataDir, attachment.storagePath);
  const extractedTextPath = attachment.extractedTextPath
    ? await copyAttachmentFile(dataDir, attachment.extractedTextPath)
    : null;

  const copy = await repo.create({
    chatId: owner.chatId,
    messageId: owner.messageId,
    executionId: null,
    executionHistoryId: null,
    direction: attachment.direction,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    storagePath,
    extractedTextPath,
    status: attachment.status,
    createdAt,
    indexedAt: attachment.indexedAt,
  });
  repo.copyChunks(attachment.id, copy.id);
  return copy;
}
