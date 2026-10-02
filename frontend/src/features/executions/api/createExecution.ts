import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { LangGraphAbstraction } from "../types";

export interface CreatedExecution {
  executionId: number;
  graphId: number;
  graph: LangGraphAbstraction;
}

export async function createExecution(
  name?: string,
): Promise<ResponseEntity<CreatedExecution>> {
  const response = await apiClient.post("/api/executions", { name });
  return response.data;
}
