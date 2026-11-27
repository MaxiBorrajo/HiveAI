import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { Rubric } from "../types.ts";

export async function getRubric(
  executionId: string,
): Promise<ResponseEntity<{ rubric: Rubric | null }>> {
  const response = await apiClient.get(`/api/executions/${executionId}/rubric`);
  return response.data;
}

export async function saveRubric(
  executionId: string,
  rubric: string,
): Promise<ResponseEntity<{ rubric: Rubric }>> {
  const response = await apiClient.put(`/api/executions/${executionId}/rubric`, {
    rubric,
  });
  return response.data;
}
