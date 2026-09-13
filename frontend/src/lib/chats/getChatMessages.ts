import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { ChatSummary, StoredMessage } from "@/types/chat";

export interface GetChatMessagesResponse {
  chat: ChatSummary;
  messages: StoredMessage[];
}

export async function getChatMessages(
  chatId: string,
): Promise<ResponseEntity<GetChatMessagesResponse>> {
  const response = await apiClient.get(`/api/chats/${chatId}`);
  return response.data;
}
