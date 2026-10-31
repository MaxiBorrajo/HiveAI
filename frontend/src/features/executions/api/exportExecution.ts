import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface SecretWarning {
  nodeId: string;
  field: string;
}

export interface ExportedExecution {
  filename: string;
  file: unknown;
  secretWarnings: SecretWarning[];
}

export async function exportExecution(
  id: string,
): Promise<ResponseEntity<ExportedExecution>> {
  const response = await apiClient.get(`/api/executions/${id}/export`);
  return response.data;
}
