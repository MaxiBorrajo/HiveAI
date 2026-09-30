import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { Execution } from "@/types/execution";

export interface UpdateExecutionDto {
  name: string;
}

export async function updateExecution(
  id: string,
  dto: UpdateExecutionDto,
): Promise<ResponseEntity<Execution>> {
  const response = await apiClient.patch(`/api/executions/${id}`, dto);
  return response.data;
}
