import axios from "axios";
import { API_URL } from "../config";
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
}

export async function getPlugins(): Promise<Plugin[]> {
  const response = await axios.get(`${API_URL}/api/plugins`);
  const plugins: BackendPlugin[] = response.data;

  return plugins.map((plugin) => ({
    id: plugin.name,
    name: plugin.name,
    description: plugin.description,
    active: plugin.active,
    selectionTests: plugin.selectionTests || [],
    executionTests: plugin.executionTests || [],
  }));
}
