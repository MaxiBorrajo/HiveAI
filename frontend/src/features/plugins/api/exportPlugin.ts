import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export async function exportPlugin(
  name: string,
): Promise<ResponseEntity<{ path: string }>> {
  const response = await apiClient.get(
    `/api/plugins/${encodeURIComponent(name)}/export`,
  );
  return response.data;
}
