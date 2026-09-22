import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { LangGraphAbstraction } from "@/types/execution";

export interface GenerateExecutionPayload {
  prompt: string;
  model: string;
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
  return { success: true, data: response.data };
}
