import { API_URL } from "./config";
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

export async function setPluginActive(
  name: string,
  active: boolean,
): Promise<void> {
  await fetch(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  );
}

export async function runPluginTest(
  name: string,
  type: "selection" | "execution",
  index: number,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/test/${type}/${index}`,
    {
      method: "POST",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
