/**
 * Endpoint: GET /api/plugins
 * Descripción: Obtiene la lista completa de plugins disponibles desde el backend.
 */
import { API_URL } from "@/lib/config";
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
  const response = await fetch(`${API_URL}/api/plugins`);
  const plugins: BackendPlugin[] = await response.json();

  return plugins.map((plugin) => ({
    id: plugin.name,
    name: plugin.name,
    description: plugin.description,
    active: plugin.active,
    selectionTests: plugin.selectionTests || [],
    executionTests: plugin.executionTests || [],
  }));
}
