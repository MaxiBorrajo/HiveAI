import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { Plugin, SelectionTestCase, ExecutionTestCase } from "@/types/plugin";

interface BackendPlugin {
  name: string;
  description: string;
  active: boolean;
  selectionTests?: SelectionTestCase[];
  executionTests?: ExecutionTestCase[];
  isExternal?: boolean;
}

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
    data: (response.data.data ?? []).map((plugin) => ({
      id: plugin.name,
      name: plugin.name,
      description: plugin.description,
      active: plugin.active,
      selectionTests: plugin.selectionTests || [],
      executionTests: plugin.executionTests || [],
      isExternal: plugin.isExternal ?? false,
    })),
  };
}
