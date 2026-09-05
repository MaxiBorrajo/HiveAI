/**
 * Endpoint: POST /api/plugins/:name/test/:type/:index
 * Descripción: Ejecuta un test específico (de selección o ejecución) para un plugin dado y devuelve los resultados.
 */
import { API_URL } from "@/lib/config";

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

