import { apiClient } from "../apiClient";

export async function deleteExecution(id: string): Promise<void> {
  await apiClient.delete(`/api/executions/${id}`);
}
