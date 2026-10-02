import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { Plugin } from "@/features/plugins/types";
import { toPlugin, type BackendPlugin } from "./getPlugins";

export interface PluginActiveChange {
  name: string;
  active: boolean;
}

export async function setPluginsActiveBatch(
  changes: PluginActiveChange[],
): Promise<ResponseEntity<Plugin[]>> {
  const response = await apiClient.post<ResponseEntity<BackendPlugin[]>>(
    "/api/plugins/batch-active",
    { changes },
  );

  return {
    ...response.data,
    data: (response.data.data ?? []).map(toPlugin),
  };
}
