import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type {
  Plugin,
  SelectionTestCase,
  ExecutionTestCase,
  PluginParameter,
} from "@/features/plugins/types";

export interface BackendPlugin {
  name: string;
  description: string;
  active: boolean;
  selectionTests?: SelectionTestCase[];
  executionTests?: ExecutionTestCase[];
  isExternal?: boolean;
  parameters?: PluginParameter[];
}

export function toPlugin(plugin: BackendPlugin): Plugin {
  return {
    id: plugin.name,
    name: plugin.name,
    description: plugin.description,
    active: plugin.active,
    selectionTests: plugin.selectionTests || [],
    executionTests: plugin.executionTests || [],
    isExternal: plugin.isExternal ?? false,
    parameters: plugin.parameters ?? [],
  };
}

export async function getPlugins(): Promise<ResponseEntity<Plugin[]>> {
  const response =
    await apiClient.get<ResponseEntity<BackendPlugin[]>>("/api/plugins");
  return {
    ...response.data,
    data: (response.data.data ?? []).map(toPlugin),
  };
}
