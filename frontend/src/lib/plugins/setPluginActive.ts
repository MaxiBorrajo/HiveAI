import { API_URL } from "../config";

export async function setPluginActive(
  name: string,
  active: boolean,
): Promise<void> {
  await fetch(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  );
}

