import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";

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
