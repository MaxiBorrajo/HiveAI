import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";
import type { Plugin } from "@/types/plugin";

export async function getPlugins(): Promise<ResponseEntity<Plugin[]>> {
  const response = await axios.get(`${API_URL}/api/plugins`);
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
