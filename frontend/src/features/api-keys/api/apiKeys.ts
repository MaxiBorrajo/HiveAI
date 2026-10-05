import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ApiKey, ApiKeyUsage, CloudProvider } from "../types";

// Errors are shown inline by the keys screen, so the global toast is silenced.
const quiet = { silenceErrorToast: true };

export async function listApiKeys(): Promise<ResponseEntity<ApiKey[]>> {
  return (await apiClient.get("/api/api-keys", quiet)).data;
}

export async function createApiKey(body: {
  provider: CloudProvider;
  alias: string;
  value: string;
}): Promise<ResponseEntity<ApiKey>> {
  return (await apiClient.post("/api/api-keys", body, quiet)).data;
}

export async function updateApiKey(
  id: string,
  body: { alias?: string; value?: string },
): Promise<ResponseEntity<ApiKey>> {
  return (await apiClient.patch(`/api/api-keys/${id}`, body, quiet)).data;
}

export async function getApiKeyUsage(
  id: string,
): Promise<ResponseEntity<ApiKeyUsage>> {
  return (await apiClient.get(`/api/api-keys/${id}/usage`, quiet)).data;
}

export async function deleteApiKey(
  id: string,
  force = false,
): Promise<ResponseEntity<undefined>> {
  return (
    await apiClient.delete(`/api/api-keys/${id}`, {
      ...quiet,
      params: force ? { force: true } : undefined,
    })
  ).data;
}
