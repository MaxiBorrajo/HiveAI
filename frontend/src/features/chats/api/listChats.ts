import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ChatSummary } from "@/features/chats/types";

export async function listChats(): Promise<ResponseEntity<ChatSummary[]>> {
  const response = await apiClient.get("/api/chats");
  return response.data;
}
