import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { ChatSummary } from "@/types/chat";

export interface UpdateChatDto {
  title: string;
}

export async function updateChat(
  chatId: string,
  dto: UpdateChatDto,
): Promise<ResponseEntity<ChatSummary>> {
  const response = await apiClient.patch(`/api/chats/${chatId}`, dto);
  return response.data;
}

