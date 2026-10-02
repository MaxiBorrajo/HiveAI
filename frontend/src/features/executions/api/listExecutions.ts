import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ExecutionSummary } from "@/features/executions/types";

export async function listExecutions(): Promise<
  ResponseEntity<ExecutionSummary[]>
> {
  const response = await apiClient.get("/api/executions");
  return response.data;
}
