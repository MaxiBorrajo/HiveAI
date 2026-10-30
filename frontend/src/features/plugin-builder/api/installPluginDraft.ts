import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface InstallPluginDraftResult {
  name: string;
  description: string;
}

export async function installPluginDraft(
  sessionId: string,
): Promise<ResponseEntity<InstallPluginDraftResult>> {
  const response = await apiClient.post(
    `/api/plugin-builder/${sessionId}/install`,
    {},
  );
  return response.data;
}
