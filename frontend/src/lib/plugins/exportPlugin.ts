import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";

// The backend writes the zip to the user's Downloads folder and returns its
// path instead of streaming a download response — the app's embedded
// webview doesn't reliably support <a download> + blob URLs, so a
// browser-style download here would fail silently.
export async function exportPlugin(
  name: string,
): Promise<ResponseEntity<{ path: string }>> {
  const response = await apiClient.get(
    `/api/plugins/${encodeURIComponent(name)}/export`,
  );
  return response.data;
}
