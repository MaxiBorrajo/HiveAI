import { ResponseBuilder } from "../../../core/api/response.ts";
import { ChatRepository } from "../../../infrastructure/db/repositories/chat-repository.ts";
import { MessageRepository } from "../../../infrastructure/db/repositories/message-repository.ts";
import { AttachmentRepository } from "../../../infrastructure/db/repositories/attachment-repository.ts";
import { copyAttachmentFile } from "../../../core/attachments/attachment-storage.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import type { FrontendChat } from "../types.ts";

const FORKED_TITLE_PREFIX = "Fork: ";

function forkTitle(originalTitle: string): string {
  const title = originalTitle.startsWith(FORKED_TITLE_PREFIX)
    ? originalTitle
    : `${FORKED_TITLE_PREFIX}${originalTitle}`;
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

export async function forkChat(
  db: AppDatabase,
  chatId: number,
  messageId: number,
  dataDir: string,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    if (isNaN(chatId) || isNaN(messageId)) {
      return ResponseBuilder.error(["Invalid chat or message id"], undefined, {
        status: 400,
        headers,
      });
    }

    const chatRepo = new ChatRepository(db);
    const msgRepo = new MessageRepository(db);
    const attachmentRepo = new AttachmentRepository(db);

    const original = await chatRepo.findById(chatId);
    if (!original) {
      return ResponseBuilder.error([`Chat ${chatId} not found`], undefined, {
        status: 404,
        headers,
      });
    }

    const messagesToCopy = await msgRepo.findUpToId(chatId, messageId);
    if (messagesToCopy.length === 0) {
      return ResponseBuilder.error(
        [`Message ${messageId} not found in chat ${chatId}`],
        undefined,
        { status: 404, headers },
      );
    }
    if (messagesToCopy[messagesToCopy.length - 1].id !== messageId) {
      return ResponseBuilder.error(
        [`Message ${messageId} not found in chat ${chatId}`],
        undefined,
        { status: 404, headers },
      );
    }

    const originalAttachments = await attachmentRepo.findByChatId(chatId);
    const attachmentsByMessage = new Map<number, typeof originalAttachments>();
    for (const attachment of originalAttachments) {
      if (attachment.messageId === null) continue;
      const list = attachmentsByMessage.get(attachment.messageId) ?? [];
      list.push(attachment);
      attachmentsByMessage.set(attachment.messageId, list);
    }

    const now = Date.now();
    const newChatId = await chatRepo.create({
      title: forkTitle(original.title),
      createdAt: now,
      updatedAt: now,
      messageCount: messagesToCopy.length,
    });

    for (const message of messagesToCopy) {
      const newMessageId = await msgRepo.create({
        chatId: newChatId,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        metadata: message.metadata,
        vector: message.vector,
      });

      const attachmentsForMessage = attachmentsByMessage.get(message.id) ?? [];
      for (const attachment of attachmentsForMessage) {
        const newStoragePath = await copyAttachmentFile(
          dataDir,
          attachment.storagePath,
        );
        const newExtractedTextPath = attachment.extractedTextPath
          ? await copyAttachmentFile(dataDir, attachment.extractedTextPath)
          : null;

        await attachmentRepo.create({
          chatId: newChatId,
          messageId: newMessageId,
          executionId: null,
          executionHistoryId: null,
          direction: attachment.direction,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          storagePath: newStoragePath,
          extractedTextPath: newExtractedTextPath,
          status: attachment.status,
          createdAt: now,
        });
      }
    }

    const newChat = await chatRepo.findById(newChatId);
    const formattedChat: FrontendChat = {
      ...newChat!,
      id: newChat!.id.toString(),
    };

    return ResponseBuilder.success(formattedChat, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error([`Failed to fork chat: ${detail}`], undefined, {
      status: 500,
      headers,
    });
  }
}
