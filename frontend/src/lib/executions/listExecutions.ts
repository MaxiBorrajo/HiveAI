import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { ExecutionSummary } from "@/types/execution";

export async function listExecutions(): Promise<
  ResponseEntity<ExecutionSummary[]>
> {
  const response = await apiClient.get("/api/executions");
  return response.data;
}
