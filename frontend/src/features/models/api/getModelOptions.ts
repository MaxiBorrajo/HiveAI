import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ModelOptionGroup } from "@/features/models/types";

export async function getModelOptions(): Promise<
  ResponseEntity<ModelOptionGroup[]>
> {
  const response = await apiClient.get("/api/models/options");
  return response.data;
}
