import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { ChatMode } from "@/types/chat";

export async function setMode(
  mode: ChatMode,
): Promise<ResponseEntity<ChatMode[]>> {
  const { name, parameters } = mode;
  const response = await apiClient.put("/api/modes", {
    name,
    parameters,
  });
  return response.data;
}
