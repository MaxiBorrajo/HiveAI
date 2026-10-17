import { apiClient } from "./apiClient";
import type { ResponseEntity } from "./config";
import { reportSuccess } from "./toastManager";

export function stringifyContent(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

export async function downloadFile(
  filename: string,
  content: string,
): Promise<void> {
  try {
    const { data } = await apiClient.post<ResponseEntity<{ path: string }>>(
      "/api/downloads",
      { filename, content },
    );
    if (data?.data?.path) reportSuccess("File saved", data.data.path);
  } catch {
  }
}
