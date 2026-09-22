import { apiClient } from "../apiClient";

export async function deleteExecution(id: string): Promise<void> {
  const response = await apiClient.delete(`/api/executions/${id}`);
  return response.data;
}
