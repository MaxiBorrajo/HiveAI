import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface ImportPluginResult {
  name: string;
  description: string;
}

/** Uploads a plugin `.zip`; the server unpacks and installs it. */
export async function importPlugin(
  file: File,
): Promise<ResponseEntity<ImportPluginResult>> {
  const form = new FormData();
  form.append("file", file, file.name);

  const response = await apiClient.post("/api/plugins/import", form);
  return response.data;
}
