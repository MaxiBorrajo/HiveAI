import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export async function saveTestResults(
  data: unknown,
): Promise<ResponseEntity<{ path: string }>> {
  const response = await apiClient.post("/api/plugins/test-results", data);
  return response.data;
}
