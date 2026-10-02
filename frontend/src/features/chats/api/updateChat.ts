import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ChatSummary } from "@/features/chats/types";

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

