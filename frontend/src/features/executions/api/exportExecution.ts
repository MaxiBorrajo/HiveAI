import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface SecretWarning {
  nodeId: string;
  field: string;
}

export interface ExportedExecution {
  /** False when secrets were found and the export waits for confirmation. */
  saved: boolean;
  path?: string;
  secretWarnings: SecretWarning[];
}

export async function exportExecution(
  id: string,
  options: { confirmSecrets?: boolean } = {},
): Promise<ResponseEntity<ExportedExecution>> {
  const response = await apiClient.get(`/api/executions/${id}/export`, {
    params: options.confirmSecrets ? { confirmSecrets: 1 } : undefined,
  });
  return response.data;
}
