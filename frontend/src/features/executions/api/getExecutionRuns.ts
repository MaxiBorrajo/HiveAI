import type { RunSummary } from "../types.ts";
import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export async function getExecutionRuns(
  id: string,
): Promise<ResponseEntity<{ runs: RunSummary[] }>> {
  const response = await apiClient.get(`/api/executions/${id}/runs`);
  return response.data;
}
