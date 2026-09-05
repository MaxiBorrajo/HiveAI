/**
 * Endpoint: POST /api/interactions/:id/:decision
 * Descripción: Resuelve una interacción pendiente enviando la decisión (aprobar o rechazar) al backend.
 */
import { API_URL } from "@/lib/config";

export async function resolveInteraction(
  id: string,
  decision: "approve" | "reject",
): Promise<void> {
  await fetch(
    `${API_URL}/api/interactions/${encodeURIComponent(id)}/${decision}`,
    { method: "POST" },
  );
}
