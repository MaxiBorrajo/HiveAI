import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { PluginConfigFieldValue } from "../types";

const quiet = { silenceErrorToast: true };

export async function getPluginConfig(
  name: string,
): Promise<ResponseEntity<PluginConfigFieldValue[]>> {
  return (
    await apiClient.get(
      `/api/plugins/${encodeURIComponent(name)}/config`,
      quiet,
    )
  ).data;
}

export async function setPluginConfigValue(
  name: string,
  key: string,
  value: string,
): Promise<ResponseEntity<undefined>> {
  return (
    await apiClient.put(
      `/api/plugins/${encodeURIComponent(name)}/config/${encodeURIComponent(key)}`,
      { value },
      quiet,
    )
  ).data;
}

export async function deletePluginConfigValue(
  name: string,
  key: string,
): Promise<ResponseEntity<undefined>> {
  return (
    await apiClient.delete(
      `/api/plugins/${encodeURIComponent(name)}/config/${encodeURIComponent(key)}`,
      quiet,
    )
  ).data;
}
