import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { ChatMode } from "@/types/chat";

export async function getModes(): Promise<ResponseEntity<ChatMode[]>> {
  const response = await apiClient.get("/api/modes");
  return response.data;
}
