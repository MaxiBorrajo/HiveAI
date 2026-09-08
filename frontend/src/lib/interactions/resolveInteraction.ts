import { API_URL } from "../config";

export async function resolveInteraction(
  id: string,
  decision: "approve" | "reject",
): Promise<void> {
  await fetch(
    `${API_URL}/api/interactions/${encodeURIComponent(id)}/${decision}`,
    { method: "POST" },
  );
}

