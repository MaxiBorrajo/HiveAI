import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";

export interface ImportPluginResult {
  name: string;
  description: string;
}

// `files` comes straight from an <input webkitdirectory> change event — each
// File carries its `webkitRelativePath` (e.g. "my-plugin/index.ts"), which
// is what lets the backend reconstruct the folder structure server-side.
// Browsers never expose the real absolute path of a user-picked folder, so
// this is the only way to hand the plugin's contents to the backend.
export async function importPlugin(files: FileList): Promise<ResponseEntity<ImportPluginResult>> {
  const form = new FormData();
  for (const file of Array.from(files)) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    form.append(relativePath, file, relativePath);
  }

  const response = await apiClient.post("/api/plugins/import", form);
  console.log("[importPlugin] raw response:", response.status, response.data);
  return response.data;
}
