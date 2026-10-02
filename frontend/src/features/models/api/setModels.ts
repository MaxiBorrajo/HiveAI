import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { CurrentModels } from "@/features/models/types";

export async function setModels(
  patch: Partial<CurrentModels>,
): Promise<ResponseEntity<CurrentModels>> {
  const response = await apiClient.put("/api/models/current", patch);
  return response.data;
}
