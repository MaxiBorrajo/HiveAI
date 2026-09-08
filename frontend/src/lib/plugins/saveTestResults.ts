import { API_URL } from "../config";

export async function saveTestResults(
  data: unknown,
): Promise<{ path: string }> {
  const response = await fetch(`${API_URL}/api/plugins/test-results`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

