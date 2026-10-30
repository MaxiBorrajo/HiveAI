import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { PluginDraft, TestSuiteQualityReport } from "../types";

export interface UpdatePluginDraftResult {
  sessionId: string;
  draft: PluginDraft;
  sourceCode: string;
  qualityReport?: TestSuiteQualityReport;
  issues: string[];
}

export async function updatePluginDraft(
  sessionId: string,
  draft: PluginDraft,
): Promise<ResponseEntity<UpdatePluginDraftResult>> {
  const response = await apiClient.put(`/api/plugin-builder/${sessionId}`, {
    draft,
  });
  return response.data;
}
