import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface UpdateStatus {
  /** Version of the running build; null when running from source. */
  currentVersion: string | null;
  readyVersion: string | null;
}

export async function getUpdateStatus(): Promise<ResponseEntity<UpdateStatus>> {
  const response = await apiClient.get("/api/app/update", {
    silenceErrorToast: true,
  });
  return response.data;
}
