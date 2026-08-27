import type { Plugin } from "@/types/plugin";

const MOCK_PLUGINS: Plugin[] = [
  {
    id: "file-search",
    name: "FileSearchPlugin",
    description: "Busca archivos en el sistema por nombre o contenido.",
  },
  {
    id: "memory",
    name: "MemoryPlugin",
    description: "Recuerda y recupera información sobre el usuario.",
  },
  {
    id: "web-search",
    name: "WebSearchPlugin",
    description: "Busca información actualizada en internet.",
  },
];

// TODO: reemplazar por la llamada real al backend (HTTP o bindings) para
// obtener los plugins registrados en el HiveMicrokernel.
export async function getPlugins(): Promise<Plugin[]> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return MOCK_PLUGINS;
}
