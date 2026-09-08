import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";

export async function setPluginActive(
  name: string,
  active: boolean,
): Promise<ResponseEntity<string>> {
  const result = await axios.post(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/${active ? "activate" : "deactivate"}`,
  );

  return result.data;
}
