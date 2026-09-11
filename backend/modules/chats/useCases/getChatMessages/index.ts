import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { getChat } from "../../../../core/memory/chatStore.ts";
import { getAllMessages } from "../../../../core/memory/messageStore.ts";
import type { GetChatMessagesResponse } from "./types.ts";

export async function getChatMessages(
  hive: HiveMicrokernel,
  chatId: string,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const dataDir = hive.getConfig().get("dataDir");

    const chat = await getChat(dataDir, chatId);
    if (!chat) {
      return ResponseBuilder.error([`Chat '${chatId}' was not found.`], undefined, {
        headers,
        status: 404,
      });
    }

    const messages = await getAllMessages(dataDir, chatId);

    const response: GetChatMessagesResponse = { chat, messages };
    return ResponseBuilder.success(response, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to load chat messages: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
