import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { CurrentModels } from "@/types/model";

export async function setModels(
  patch: Partial<CurrentModels>,
): Promise<ResponseEntity<CurrentModels>> {
  const response = await apiClient.put("/api/models/current", patch);
  return response.data;
}
