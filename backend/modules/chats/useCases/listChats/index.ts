import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ChatRepository } from "../../../../infrastructure/db/repositories/ChatRepository.ts";
import type { FrontendChat } from "../../types/frontend.ts";

export async function listChats(
  db: AppDatabase,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const chatRepo = new ChatRepository(db);
    const chats = await chatRepo.findAll();
    const formattedChats: FrontendChat[] = chats.map((c) => ({
      ...c,
      id: c.id.toString(),
    }));
    return ResponseBuilder.success(formattedChats, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to list chats: ${detail}`],
      undefined,
      {
        headers,
        status: 500,
      },
    );
  }
}
