import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { PendingInteraction } from "./types.ts";

export async function listPendingInteractions(): Promise<
  ResponseEntity<PendingInteraction[]>
> {
  const response = await apiClient.get("/api/interactions");
  return response.data;
}
