import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { LangGraphAbstraction } from "@/types/execution";

export interface ExecutionDetails {
  execution: any;
  graph?: {
    id: number;
    graph: LangGraphAbstraction;
    state: any;
    createdAt: number;
  };
}

export async function getExecution(
  id: string,
): Promise<ResponseEntity<ExecutionDetails>> {
  const response = await apiClient.get(`/api/executions/${id}`);
  // return as data property for consistency
  return { success: true, data: response.data };
}
