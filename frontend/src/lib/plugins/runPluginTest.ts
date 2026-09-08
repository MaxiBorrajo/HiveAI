import axios from "axios";
import { API_URL } from "../config";

export async function runPluginTest(
  name: string,
  type: "selection" | "execution",
  index: number,
  signal: AbortSignal,
) {
  const response = await axios.post(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/test/${type}/${index}`,
    {},
    { signal },
  );
  return response.data;
}
