import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ChatSummary } from "@/features/chats/types";

export async function forkChat(
  chatId: string,
  messageId: string,
  /** Copy only what came before the message, leaving it out. */
  before = false,
): Promise<ResponseEntity<ChatSummary>> {
  const response = await apiClient.post(`/api/chats/${chatId}/fork`, {
    messageId: Number(messageId),
    ...(before ? { before: true } : {}),
  });
  return response.data;
}
