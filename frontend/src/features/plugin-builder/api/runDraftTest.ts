import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { DraftTestResult } from "../types";

export type DraftTestKind = "selection" | "execution";

export async function runDraftTest(
  sessionId: string,
  kind: DraftTestKind,
  index: number,
  signal?: AbortSignal,
): Promise<ResponseEntity<DraftTestResult>> {
  const response = await apiClient.post(
    `/api/plugin-builder/${sessionId}/test/${kind}/${index}`,
    {},
    { signal },
  );
  return response.data;
}
