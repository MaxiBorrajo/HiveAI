import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type {
  ModelSetting,
  ModelSettingValue,
} from "@/features/model-settings/types";

export async function setModelSettings(
  values: Record<string, ModelSettingValue>,
): Promise<ResponseEntity<ModelSetting[]>> {
  const response = await apiClient.put("/api/model-settings", { values });
  return response.data;
}
