import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { JudgeChoice, RunGrade } from "../types.ts";

export async function gradeRuns(
  executionId: string,
  historyIds: number[],
  judge: JudgeChoice,
  rubricId: number,
): Promise<ResponseEntity<{ grades: RunGrade[] }>> {
  const response = await apiClient.post(
    `/api/executions/${executionId}/runs/grade`,
    { historyIds, judge, rubricId },
    { timeout: 0 },
  );
  return response.data;
}
