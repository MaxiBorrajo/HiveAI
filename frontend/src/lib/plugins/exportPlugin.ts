import { apiClient } from "../apiClient";

export async function exportPlugin(name: string): Promise<void> {
  const response = await apiClient.get(
    `/api/plugins/${encodeURIComponent(name)}/export`,
    {
      responseType: "blob",
    },
  );

  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}
