import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { listChats as listChatsFromMemory } from "../../../../core/memory/chatStore.ts";

export async function listChats(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const dataDir = hive.getConfig().get("dataDir");
    const chats = await listChatsFromMemory(dataDir);
    return ResponseBuilder.success(chats, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error([`Failed to list chats: ${detail}`], undefined, {
      headers,
      status: 500,
    });
  }
}
