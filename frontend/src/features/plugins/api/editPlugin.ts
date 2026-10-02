import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface EditPluginResult {
  name: string;
  dir: string;
}

export async function editPlugin(
  name: string,
): Promise<ResponseEntity<EditPluginResult>> {
  const response = await apiClient.post(
    `/api/plugins/${encodeURIComponent(name)}/edit`,
  );
  return response.data;
}
