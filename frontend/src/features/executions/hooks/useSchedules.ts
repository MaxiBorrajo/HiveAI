import { useCallback, useEffect, useState } from "react";
import { getSchedules } from "../api/schedules";
import type { SchedulesPayload } from "../types";
import { getErrorMessage } from "@/lib/errors";

/** Schedules + run log of one execution; reloads when the execution changes. */
export function useSchedules(
  executionId: string | null,
  enabled = true,
  /** Change it to force a reload (e.g. a scheduled run just finished). */
  refreshKey: number = 0,
) {
  const [state, setState] = useState<{
    executionId: string;
    data: SchedulesPayload;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!executionId) return;
    try {
      const { data } = await getSchedules(executionId);
      if (data) setState({ executionId, data });
      setFailure(null);
    } catch (e) {
      setFailure(getErrorMessage(e, "Could not load the schedules."));
    }
  }, [executionId]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload, enabled, refreshKey]);

  const data = state && state.executionId === executionId ? state.data : null;
  return { data, error: failure, reload };
}
