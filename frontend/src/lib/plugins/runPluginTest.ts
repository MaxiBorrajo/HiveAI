import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";
import type { ExecutionTestResult, SelectionTestResult } from "./types.ts";

export async function runPluginTest(
  name: string,
  type: "selection" | "execution",
  index: number,
  signal: AbortSignal,
): Promise<ResponseEntity<SelectionTestResult | ExecutionTestResult>> {
  const response = await axios.post(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/test/${type}/${index}`,
    {},
    { signal },
  );
  return response.data;
}
