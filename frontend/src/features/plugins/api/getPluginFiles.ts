import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface PluginSourceFile {
  name: string;
  content: string;
}

/** Source of an installed (external) plugin. */
export async function getPluginFiles(name: string): Promise<PluginSourceFile[]> {
  const response = await apiClient.get<ResponseEntity<{ files: PluginSourceFile[] }>>(
    `/api/plugins/${encodeURIComponent(name)}/files`,
  );
  return response.data.data?.files ?? [];
}
