import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { CurrentModels } from "@/types/model";

export async function getCurrentModels(): Promise<
  ResponseEntity<CurrentModels>
> {
  const response = await apiClient.get("/api/models/current");
  return response.data;
}
