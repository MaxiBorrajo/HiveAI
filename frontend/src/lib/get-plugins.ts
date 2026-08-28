import type { Plugin } from "@/types/plugin";

interface BackendPlugin {
  name: string;
  description: string;
  active: boolean;
}

export async function getPlugins(): Promise<Plugin[]> {
  const response = await fetch("http://localhost:8000/plugins");
  const plugins: BackendPlugin[] = await response.json();

  return plugins.map((plugin) => ({
    id: plugin.name,
    name: plugin.name,
    description: plugin.description,
    active: plugin.active,
  }));
}

export async function setPluginActive(
  name: string,
  active: boolean,
): Promise<void> {
  await fetch(
    `http://localhost:8000/plugins/${encodeURIComponent(name)}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  );
}
