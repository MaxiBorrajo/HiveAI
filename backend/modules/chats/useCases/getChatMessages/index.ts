import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ChatRepository } from "../../../../infrastructure/db/repositories/ChatRepository.ts";
import { MessageRepository } from "../../../../infrastructure/db/repositories/MessageRepository.ts";
import type { ChatStepMetadata } from "../../types/memory.ts";
import type { ChatMessageResponse } from "./types.ts";

export async function getChatMessages(
  db: AppDatabase,
  chatId: number,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const dataDir = hive.getConfig().get("dataDir");

    const chat = await chatRepo.findById(chatId);
    if (!chat) {
      return ResponseBuilder.error(
        [`Chat '${chatId}' was not found.`],
        undefined,
        {
          headers,
          status: 404,
        },
      );
    }

    const messages = await msgRepo.findByChatId(chatId);

    const formattedMessages: ChatMessageResponse[] = messages.map((m) => ({
      id: m.id,
      chatId: m.chatId,
      role: (m.role === "assistant" ? "agent" : m.role) as "user" | "agent",
      content: m.content,
      timestamp: m.timestamp,
      metadata: m.metadata
        ? (JSON.parse(m.metadata) as ChatStepMetadata)
        : null,
    }));

    return ResponseBuilder.success(
      { chat, messages: formattedMessages },
      { headers },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to load chat messages: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
