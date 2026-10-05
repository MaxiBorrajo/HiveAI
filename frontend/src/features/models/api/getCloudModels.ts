import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { CloudModelGroup } from "@/features/models/types";

export async function getCloudModels(): Promise<
  ResponseEntity<CloudModelGroup[]>
> {
  const response = await apiClient.get("/api/models/cloud");
  return response.data;
}
