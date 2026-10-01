import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ExecutionTestResult, SelectionTestResult } from "./types.ts";

export async function runPluginTest(
  name: string,
  type: "selection" | "execution",
  index: number,
  signal: AbortSignal,
): Promise<ResponseEntity<SelectionTestResult | ExecutionTestResult>> {
  const response = await apiClient.post(
    `/api/plugins/${encodeURIComponent(name)}/test/${type}/${index}`,
    {},
    { signal, silenceErrorToast: true },
  );
  return response.data;
}
