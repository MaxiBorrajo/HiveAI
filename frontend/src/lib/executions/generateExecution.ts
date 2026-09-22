import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { LangGraphAbstraction } from "@/types/execution";

export interface GenerateExecutionPayload {
  content: string;
  executionId?: number;
}

export interface GenerateExecutionResponse {
  executionId: number;
  graphId: number;
  graph: LangGraphAbstraction;
}

export async function generateExecution(
  payload: GenerateExecutionPayload,
): Promise<ResponseEntity<GenerateExecutionResponse>> {
  const response = await apiClient.post("/api/executions/generate", payload);
  return response.data;
}
