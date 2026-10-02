import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export async function setPluginActive(
  name: string,
  active: boolean,
): Promise<ResponseEntity<string>> {
  const result = await apiClient.post(
    `/api/plugins/${encodeURIComponent(name)}/${active ? "activate" : "deactivate"}`,
  );

  return result.data;
}
