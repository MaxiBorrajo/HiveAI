/**
 * Endpoint: POST /api/plugins/:name/activate o /api/plugins/:name/deactivate
 * Descripción: Activa o desactiva un plugin específico en el backend.
 */
import { API_URL } from "@/lib/config";

export async function setPluginActive(
  name: string,
  active: boolean,
): Promise<void> {
  await fetch(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  );
}
