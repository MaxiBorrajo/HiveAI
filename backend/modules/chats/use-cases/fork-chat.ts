import { ResponseBuilder } from "../../../core/api/response.ts";
import { ChatRepository } from "../../../infrastructure/db/repositories/chat-repository.ts";
import { MessageRepository } from "../../../infrastructure/db/repositories/message-repository.ts";
import { AttachmentRepository } from "../../../infrastructure/db/repositories/attachment-repository.ts";
import { duplicateAttachment } from "../../../core/attachments/duplicate-attachment.ts";
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
  /** `before`: stop just short of the message, to send an edited version of it. */
  options: { before?: boolean } = {},
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

    const upToMessage = await msgRepo.findUpToId(chatId, messageId);
    if (upToMessage.length === 0) {
      return ResponseBuilder.error(
        [`Message ${messageId} not found in chat ${chatId}`],
        undefined,
        { status: 404, headers },
      );
    }
    if (upToMessage[upToMessage.length - 1].id !== messageId) {
      return ResponseBuilder.error(
        [`Message ${messageId} not found in chat ${chatId}`],
        undefined,
        { status: 404, headers },
      );
    }
    // Before the first message this is empty: a fresh chat to start over in.
    const messagesToCopy = options.before
      ? upToMessage.slice(0, -1)
      : upToMessage;

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
        await duplicateAttachment(
          dataDir,
          attachmentRepo,
          attachment,
          { chatId: newChatId, messageId: newMessageId },
          now,
        );
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
