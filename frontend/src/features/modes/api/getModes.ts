import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ChatMode } from "@/features/modes/types";

export async function getModes(): Promise<ResponseEntity<ChatMode[]>> {
  const response = await apiClient.get("/api/modes");
  return response.data;
}
