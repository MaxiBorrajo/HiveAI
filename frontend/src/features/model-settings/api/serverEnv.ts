import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface ServerEnvStatus {
  pending: boolean;
  kvCacheType: string | null;
  flashAttention: boolean;
}

export async function getServerEnvStatus(): Promise<
  ResponseEntity<ServerEnvStatus>
> {
  const response = await apiClient.get("/api/model-settings/server-env");
  return response.data;
}

export async function dismissServerEnvPrompt(): Promise<void> {
  await apiClient.post("/api/model-settings/server-env/dismiss");
}
