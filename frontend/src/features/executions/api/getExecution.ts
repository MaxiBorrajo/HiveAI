import type { ExecutionDetails } from "../types.ts";
import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export async function getExecution(
  id: string,
): Promise<ResponseEntity<ExecutionDetails>> {
  const response = await apiClient.get(`/api/executions/${id}`);
  return response.data;
}
