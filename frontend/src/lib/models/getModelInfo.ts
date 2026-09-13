import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { ModelInfo } from "@/types/model";

export async function getModelInfo(
  name: string,
): Promise<ResponseEntity<ModelInfo>> {
  const response = await apiClient.get(
    `/api/models/${encodeURIComponent(name)}`,
  );
  return response.data;
}
