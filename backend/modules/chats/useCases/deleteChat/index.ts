import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { deleteChat as deleteChatFromMemory, getChat } from "../../../../core/memory/chatStore.ts";

export async function deleteChat(
  hive: HiveMicrokernel,
  chatId: string,
  headers: Record<string, string>,
): Promise<Response> {
  const dataDir = hive.getConfig().get("dataDir");

  const chat = await getChat(dataDir, chatId);
  if (!chat) {
    return ResponseBuilder.error([`Chat '${chatId}' was not found.`], undefined, {
      headers,
      status: 404,
    });
  }

  await deleteChatFromMemory(dataDir, chatId);
  return ResponseBuilder.success({ success: true }, { headers });
}
