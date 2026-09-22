import { ResponseBuilder } from "../../../../core/api/response.ts";
import { ChatRepository } from "../../../../infrastructure/db/repositories/ChatRepository.ts";
import { MessageRepository } from "../../../../infrastructure/db/repositories/MessageRepository.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import type { FrontendChat, FrontendMessage } from "../../types/frontend.ts";

export async function getChatMessages(
  db: AppDatabase,
  chatIdStr: string,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const chatId = parseInt(chatIdStr);
    if (isNaN(chatId)) {
      return ResponseBuilder.error(["Invalid chat id"], undefined, {
        status: 400,
        headers,
      });
    }

    const chatRepo = new ChatRepository(db);
    const msgRepo = new MessageRepository(db);

    const chat = await chatRepo.findById(chatId);
    if (!chat) {
      return ResponseBuilder.error([`Chat ${chatId} not found`], undefined, {
        status: 404,
        headers,
      });
    }

    const messages = await msgRepo.findByChatId(chatId);

    const formattedMessages: FrontendMessage[] = messages.map((m) => ({
      ...m,
      id: m.id.toString(),
      chatId: m.chatId.toString(),
      metadata: m.metadata ? JSON.parse(m.metadata) : null,
    }));

    const formattedChat: FrontendChat = { ...chat, id: chat.id.toString() };

    return ResponseBuilder.success(
      { chat: formattedChat, messages: formattedMessages },
      { headers },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to load messages: ${detail}`],
      undefined,
      {
        status: 500,
        headers,
      },
    );
  }
}
