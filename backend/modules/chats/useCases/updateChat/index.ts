import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ChatRepository } from "../../../../infrastructure/db/repositories/ChatRepository.ts";
import type { FrontendChat } from "../../types/frontend.ts";

export interface UpdateChatDto {
  title?: string;
  name?: string;
}

export async function updateChat(
  db: AppDatabase,
  chatId: number,
  dto: UpdateChatDto,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    if (isNaN(chatId)) {
      return ResponseBuilder.error(["Invalid chat id"], undefined, {
        status: 400,
        headers,
      });
    }

    const title = (dto?.title ?? dto?.name)?.trim();
    if (!title) {
      return ResponseBuilder.error(
        ["Chat title is required and cannot be empty"],
        undefined,
        {
          status: 400,
          headers,
        },
      );
    }

    const chatRepo = new ChatRepository(db);
    const existing = await chatRepo.findById(chatId);

    if (!existing) {
      return ResponseBuilder.error([`Chat ${chatId} not found`], undefined, {
        status: 404,
        headers,
      });
    }

    existing.title = title;
    existing.updatedAt = Date.now();
    await chatRepo.update(existing);

    const formattedChat: FrontendChat = {
      ...existing,
      id: existing.id.toString(),
    };

    return ResponseBuilder.success(formattedChat, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to update chat: ${detail}`],
      undefined,
      {
        status: 500,
        headers,
      },
    );
  }
}
