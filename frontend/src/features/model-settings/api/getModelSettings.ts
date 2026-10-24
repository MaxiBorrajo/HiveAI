import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ModelSetting } from "@/features/model-settings/types";

export async function getModelSettings(): Promise<
  ResponseEntity<ModelSetting[]>
> {
  const response = await apiClient.get("/api/model-settings");
  return response.data;
}
