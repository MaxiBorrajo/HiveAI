import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";

export async function deleteChat(
  chatId: string,
): Promise<ResponseEntity<{ success: boolean }>> {
  const response = await apiClient.delete(`/api/chats/${chatId}`);
  return response.data;
}
