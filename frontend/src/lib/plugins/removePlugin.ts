import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";

export async function removePlugin(
  name: string,
): Promise<ResponseEntity<undefined>> {
  const response = await apiClient.delete(
    `/api/plugins/${encodeURIComponent(name)}`,
  );
  return response.data;
}
