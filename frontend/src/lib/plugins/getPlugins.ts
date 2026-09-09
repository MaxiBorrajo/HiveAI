import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { Plugin } from "@/types/plugin";

export async function getPlugins(): Promise<ResponseEntity<Plugin[]>> {
  const response = await apiClient.get("/api/plugins");
  response.data.data = response.data.data.map((plugin) => ({
    id: plugin.name,
    name: plugin.name,
    description: plugin.description,
    active: plugin.active,
    selectionTests: plugin.selectionTests || [],
    executionTests: plugin.executionTests || [],
  }));
  return response.data;
}
