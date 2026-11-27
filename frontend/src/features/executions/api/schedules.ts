import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type {
  BackgroundSettings,
  Schedule,
  ScheduleDraft,
  SchedulesPayload,
} from "../types.ts";

export async function getSchedules(
  executionId: string,
): Promise<ResponseEntity<SchedulesPayload>> {
  const response = await apiClient.get(`/api/schedules/executions/${executionId}`);
  return response.data;
}

export async function createSchedule(
  executionId: string,
  draft: ScheduleDraft,
): Promise<ResponseEntity<Schedule>> {
  const response = await apiClient.post(
    `/api/schedules/executions/${executionId}`,
    draft,
  );
  return response.data;
}

export async function updateSchedule(
  id: number,
  patch: Partial<ScheduleDraft> & { enabled?: boolean },
): Promise<ResponseEntity<Schedule>> {
  const response = await apiClient.patch(`/api/schedules/${id}`, patch);
  return response.data;
}

export async function deleteSchedule(id: number): Promise<void> {
  await apiClient.delete(`/api/schedules/${id}`);
}

export async function dismissScheduleRun(id: number): Promise<void> {
  await apiClient.post(`/api/schedules/runs/${id}/dismiss`);
}

export async function getBackgroundSettings(): Promise<
  ResponseEntity<BackgroundSettings>
> {
  const response = await apiClient.get("/api/app/background");
  return response.data;
}

export async function updateBackgroundSettings(
  patch: Partial<BackgroundSettings>,
): Promise<ResponseEntity<BackgroundSettings>> {
  const response = await apiClient.put("/api/app/background", patch);
  return response.data;
}

export async function previewSchedule(
  draft: Partial<ScheduleDraft>,
): Promise<ResponseEntity<{ nextRuns: number[] }>> {
  const response = await apiClient.post("/api/schedules/preview", draft, {
    // The form shows the problem inline while typing; no toast per keystroke.
    silenceErrorToast: true,
  } as never);
  return response.data;
}

export interface FinishedScheduleRun {
  id: number;
  executionId: number;
  status: "ok" | "failed" | "missed" | "skipped";
  error: string | null;
  finishedAt: number;
}

export interface ScheduleActivity {
  /** Server clock when this answer was made. */
  serverTime: number;
  running: { id: number; executionId: number; startedAt: number }[];
  /** Runs that ended since the `since` we sent (empty without it). */
  finished: FinishedScheduleRun[];
}

export async function getScheduleActivity(
  since?: number,
): Promise<ResponseEntity<ScheduleActivity>> {
  const response = await apiClient.get("/api/schedules/activity", {
    params: since === undefined ? undefined : { since },
    // Polled in the background: a hiccup must never pop a toast.
    silenceErrorToast: true,
  } as never);
  return response.data;
}
