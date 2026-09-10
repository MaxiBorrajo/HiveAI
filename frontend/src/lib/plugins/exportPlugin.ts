import { apiClient } from "../apiClient";

// Downloads a .zip of an already-imported external plugin (with its own
// name as the top-level folder inside), so it can be shared and re-imported
// on another machine through the same "Import Plugin" folder-upload flow.
// Unlike the rest of this module, the backend responds with the raw zip
// bytes here, not a ResponseEntity — so this fetches a blob directly
// instead of returning JSON.
export async function exportPlugin(name: string): Promise<void> {
  const response = await apiClient.get(`/api/plugins/${encodeURIComponent(name)}/export`, {
    responseType: "blob",
  });

  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}
