import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type {
  Plugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "@/types/plugin";

interface BackendPlugin {
  name: string;
  description: string;
  active: boolean;
  selectionTests?: SelectionTestCase[];
  executionTests?: ExecutionTestCase[];
  isExternal?: boolean;
}

export async function getPlugins(): Promise<ResponseEntity<Plugin[]>> {
  const response =
    await apiClient.get<ResponseEntity<BackendPlugin[]>>("/api/plugins");
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
