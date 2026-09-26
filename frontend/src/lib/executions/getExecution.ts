import type { ExecutionDetails } from "../../types/execution.ts";
import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";

export async function getExecution(
  id: string,
): Promise<ResponseEntity<ExecutionDetails>> {
  const response = await apiClient.get(`/api/executions/${id}`);
  console.log(response.data);
  return response.data;
}
