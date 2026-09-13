import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { ChatSummary } from "@/types/chat";

export async function listChats(): Promise<ResponseEntity<ChatSummary[]>> {
  const response = await apiClient.get("/api/chats");
  return response.data;
}
