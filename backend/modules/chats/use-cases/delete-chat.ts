import { ResponseBuilder } from "../../../core/api/response.ts";
import { ChatRepository } from "../../../infrastructure/db/repositories/chat-repository.ts";
import { AttachmentRepository } from "../../../infrastructure/db/repositories/attachment-repository.ts";
import { deleteAttachmentFile } from "../../../core/attachments/attachment-storage.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";

export async function deleteChat(
  db: AppDatabase,
  chatId: number,
  headers: Record<string, string>,
  dataDir: string,
): Promise<Response> {
  try {
    if (isNaN(chatId)) {
      return ResponseBuilder.error(["Invalid chat id"], undefined, {
        status: 400,
        headers,
      });
    }

    const chatRepo = new ChatRepository(db);
    const existing = await chatRepo.findById(chatId);

    if (!existing) {
      return ResponseBuilder.error([`Chat ${chatId} not found`], undefined, {
        status: 404,
        headers,
      });
    }

    const attachmentRepo = new AttachmentRepository(db);
    const chatAttachments = await attachmentRepo.findByChatId(chatId);
    for (const attachment of chatAttachments) {
      await deleteAttachmentFile(dataDir, attachment.storagePath);
      if (attachment.extractedTextPath) {
        await deleteAttachmentFile(dataDir, attachment.extractedTextPath);
      }
    }

    await chatRepo.delete(chatId);

    return ResponseBuilder.success(
      { deleted: true },
      {
        headers,
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to delete chat: ${detail}`],
      undefined,
      {
        status: 500,
        headers,
      },
    );
  }
}
