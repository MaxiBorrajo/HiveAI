import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export async function deleteChat(
  chatId: string,
): Promise<ResponseEntity<{ success: boolean }>> {
  const response = await apiClient.delete(`/api/chats/${chatId}`);
  return response.data;
}
