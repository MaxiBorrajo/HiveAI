import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface EmbeddingModelStatus {
  available: boolean;
  model: string;
}

export async function getEmbeddingModelStatus(): Promise<
  ResponseEntity<EmbeddingModelStatus>
> {
  const response = await apiClient.get("/api/models/embedding-status");
  return response.data;
}
