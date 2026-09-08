import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";

export async function resolveInteraction(
  id: string,
  decision: "approve" | "reject",
): Promise<ResponseEntity<string>> {
  const result = await axios.post(
    `${API_URL}/api/interactions/${encodeURIComponent(id)}/${decision}`,
  );
  return result.data;
}
