import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";

export async function resolveInteraction(
  id: string,
  decision: "approve" | "reject",
): Promise<ResponseEntity<string>> {
  const result = await apiClient.post(
    `/api/interactions/${encodeURIComponent(id)}/${decision}`,
  );
  return result.data;
}
