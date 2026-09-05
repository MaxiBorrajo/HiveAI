/**
 * Endpoint: GET /api/interactions
 * Descripción: Obtiene la lista de interacciones pendientes del backend (ej. plugins esperando aprobación del usuario).
 */
import { API_URL } from "@/lib/config";
import type { PendingInteraction } from "@/types/interaction";

export async function listPendingInteractions(): Promise<PendingInteraction[]> {
  const response = await fetch(`${API_URL}/api/interactions`);
  return response.json();
}
