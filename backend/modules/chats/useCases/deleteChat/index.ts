import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ChatRepository } from "../../../../infrastructure/db/repositories/ChatRepository.ts";

export async function deleteChat(
  db: AppDatabase,
  chatId: number,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const chatRepo = new ChatRepository(db);
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
    await chatRepo.delete(chatId);
    return ResponseBuilder.success({ success: true }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to delete chat: ${detail}`],
      undefined,
      {
        headers,
        status: 500,
      },
    );
  }
}
