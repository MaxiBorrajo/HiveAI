import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export async function deleteModel(
  name: string,
): Promise<ResponseEntity<{ name: string }>> {
  const response = await apiClient.delete("/api/models", { params: { name } });
  return response.data;
}
