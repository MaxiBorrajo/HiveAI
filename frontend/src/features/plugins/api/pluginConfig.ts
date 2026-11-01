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

/** Where a plugin's settings live; drafts and installed plugins use different routes. */
export interface PluginConfigApi {
  get(name: string): Promise<ResponseEntity<PluginConfigFieldValue[]>>;
  set(name: string, key: string, value: string): Promise<ResponseEntity<undefined>>;
  remove(name: string, key: string): Promise<ResponseEntity<undefined>>;
}

export const installedPluginConfigApi: PluginConfigApi = {
  get: getPluginConfig,
  set: setPluginConfigValue,
  remove: deletePluginConfigValue,
};

export function configApiFor(basePath: "plugins" | "drafts"): PluginConfigApi {
  const url = (name: string, key?: string) =>
    `/api/${basePath}/${encodeURIComponent(name)}/config${
      key ? `/${encodeURIComponent(key)}` : ""
    }`;
  return {
    get: async (name) => (await apiClient.get(url(name), quiet)).data,
    set: async (name, key, value) =>
      (await apiClient.put(url(name, key), { value }, quiet)).data,
    remove: async (name, key) =>
      (await apiClient.delete(url(name, key), quiet)).data,
  };
}

export const draftConfigApi = configApiFor("drafts");
