import { API_URL } from "../config";

export async function runPluginTest(
  name: string,
  type: "selection" | "execution",
  index: number,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/test/${type}/${index}`,
    {
      method: "POST",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

