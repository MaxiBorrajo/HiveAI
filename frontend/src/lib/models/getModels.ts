import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";
import type { ModelFilters, ModelInfo } from "@/types/model";

export async function getModels(
  filters?: ModelFilters,
): Promise<ResponseEntity<ModelInfo[]>> {
  const params = filters
    ? {
        name: filters.name,
        architecture: filters.architecture,
        family: filters.family,
        minSizeBytes: filters.minSizeBytes,
        maxSizeBytes: filters.maxSizeBytes,
        parameterSize: filters.parameterSize,
        capabilities: filters.capabilities,
      }
    : undefined;

  const response = await axios.get(`${API_URL}/api/models`, { params });
  return response.data;
}
