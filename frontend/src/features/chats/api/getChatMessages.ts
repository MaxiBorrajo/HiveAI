import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type {
  ChatSummary,
  ConversationUsage,
  StoredMessage,
} from "@/features/chats/types";

export interface GetChatMessagesResponse {
  chat: ChatSummary;
  messages: StoredMessage[];
  usage: ConversationUsage;
}

export async function getChatMessages(
  chatId: string,
): Promise<ResponseEntity<GetChatMessagesResponse>> {
  const response = await apiClient.get(`/api/chats/${chatId}`);
  return response.data;
}
