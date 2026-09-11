import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";

export interface EditPluginResult {
  name: string;
  dir: string;
}

// Turns an already-imported external plugin back into an editable draft
// (deactivating it and removing it from the plugin list in the process) —
// the caller is expected to open the draft editor for `name` right after.
export async function editPlugin(name: string): Promise<ResponseEntity<EditPluginResult>> {
  const response = await apiClient.post(`/api/plugins/${encodeURIComponent(name)}/edit`);
  return response.data;
}
