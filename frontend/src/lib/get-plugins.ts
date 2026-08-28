import type { Plugin } from "@/types/plugin";

interface BackendPlugin {
  name: string;
  description: string;
}

export async function getPlugins(): Promise<Plugin[]> {
  const response = await fetch("http://localhost:8001/plugins");
  const plugins: BackendPlugin[] = await response.json();

  return plugins.map((plugin) => ({
    id: plugin.name,
    name: plugin.name,
    description: plugin.description,
  }));
}
