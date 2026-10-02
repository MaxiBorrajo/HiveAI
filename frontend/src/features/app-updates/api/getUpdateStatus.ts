import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface UpdateStatus {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadUrl: string | null;
}

export async function getUpdateStatus(): Promise<ResponseEntity<UpdateStatus>> {
  const response = await apiClient.get("/api/app/update", {
    silenceErrorToast: true,
  });
  return response.data;
}
