import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { HardwareReport, ModelDetail, ModelSource, SearchParams, SearchResult } from "../types";

export async function getHardwareReport(): Promise<ResponseEntity<HardwareReport>> {
  const response = await apiClient.get("/api/hardware");
  return response.data;
}

export async function searchModels(
  { source, q, sort, filters, cursor }: SearchParams,
): Promise<ResponseEntity<SearchResult>> {
  // only the parameters that are set are sent, the backend treats a missing one as "off"
  const params: Record<string, string> = { q, sort };
  // the Ollama library is the backend default, so only the other source is spelled out
  if (source !== "ollama") params.source = source;
  if (cursor) params.cursor = cursor;
  if (filters.tools) params.tools = "1";
  if (filters.vision) params.vision = "1";
  if (filters.reasoning) params.reasoning = "1";
  if (filters.fitsOnly) params.fits = "1";
  const response = await apiClient.get("/api/model-discovery/search", { params });
  return response.data;
}

export async function getModelDetail(
  id: string,
  source: ModelSource = "ollama",
): Promise<ResponseEntity<ModelDetail>> {
  const params: Record<string, string> = { id };
  if (source !== "ollama") params.source = source;
  const response = await apiClient.get("/api/model-discovery/model", { params });
  return response.data;
}
