import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { listChats as listChatsFromMemory } from "../../../../core/memory/chatStore.ts";

export async function listChats(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Promise<Response> {
  const dataDir = hive.getConfig().get("dataDir");
  const chats = await listChatsFromMemory(dataDir);
  return ResponseBuilder.success(chats, { headers });
}
