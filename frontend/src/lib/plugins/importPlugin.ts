import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";

export interface ImportPluginResult {
  name: string;
  description: string;
}

export async function importPlugin(
  files: FileList,
): Promise<ResponseEntity<ImportPluginResult>> {
  const form = new FormData();
  for (const file of Array.from(files)) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    form.append(relativePath, file, relativePath);
  }

  const response = await apiClient.post("/api/plugins/import", form);
  console.log("[importPlugin] raw response:", response.status, response.data);
  return response.data;
}
