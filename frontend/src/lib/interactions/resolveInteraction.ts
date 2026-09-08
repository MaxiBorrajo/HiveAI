import axios from "axios";
import { API_URL } from "../config";

export async function resolveInteraction(
  id: string,
  decision: "approve" | "reject",
): Promise<void> {
  await axios.post(
    `${API_URL}/api/interactions/${encodeURIComponent(id)}/${decision}`,
  );
}
