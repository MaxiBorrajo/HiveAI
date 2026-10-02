import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { CurrentModels } from "@/features/models/types";

export async function getCurrentModels(): Promise<
  ResponseEntity<CurrentModels>
> {
  const response = await apiClient.get("/api/models/current");
  return response.data;
}
