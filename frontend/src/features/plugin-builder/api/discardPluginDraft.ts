import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export async function discardPluginDraft(
  sessionId: string,
): Promise<ResponseEntity<{ sessionId: string }>> {
  const response = await apiClient.delete(`/api/plugin-builder/${sessionId}`);
  return response.data;
}
