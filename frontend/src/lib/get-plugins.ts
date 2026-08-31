import type { Plugin, PluginTestCase } from "@/types/plugin";

interface BackendPlugin {
  name: string;
  description: string;
  active: boolean;
  testCases: PluginTestCase[];
}

export async function getPlugins(): Promise<Plugin[]> {
  const response = await fetch("http://localhost:8000/plugins");
  const plugins: BackendPlugin[] = await response.json();

  return plugins.map((plugin) => ({
    id: plugin.name,
    name: plugin.name,
    description: plugin.description,
    active: plugin.active,
    testCases: plugin.testCases,
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

export async function runPluginTest(
  name: string,
  index: number,
  signal: AbortSignal,
) {
  const response = await fetch(
    `http://localhost:8000/plugins/${encodeURIComponent(name)}/test/${index}`,
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
