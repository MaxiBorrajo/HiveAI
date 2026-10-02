import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ChatMode } from "@/features/modes/types";

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
