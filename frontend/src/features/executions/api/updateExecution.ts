import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { Execution } from "@/features/executions/types";

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
