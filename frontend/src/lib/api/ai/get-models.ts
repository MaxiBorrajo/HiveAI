/**
 * Endpoint: GET /api/models
 * Descripción: Obtiene la lista completa de modelos disponibles.
 */
import { API_URL } from "../../config.ts";
import type { Model } from "../../../types/ai.ts";

export async function getModels(): Promise<Model[]> {
  const response = await fetch(`${API_URL}/api/ai`);
  const models: Model[] = await response.json();

  return models
}
