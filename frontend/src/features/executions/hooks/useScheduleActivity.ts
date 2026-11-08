import { useCallback, useEffect, useRef, useState } from "react";
import { getScheduleActivity, type FinishedScheduleRun } from "../api/schedules";
import {
  INITIAL_ACTIVITY,
  nextSince,
  reactToActivity,
  type ActivityState,
} from "../lib/scheduleActivity";
import { reportError, reportSuccess } from "@/lib/toastManager";

export const ACTIVITY_POLL_MS = 5000;

/**
 * Called for every scheduled run that ends. Return true when you already
 * showed the person what happened (e.g. opened the result), so no toast is
 * needed on top of it.
 */
export type FinishedListener = (
  run: FinishedScheduleRun,
) => boolean | Promise<boolean>;

export interface ScheduleActivityView {
  /** Executions that have a scheduled run in flight right now. */
  runningExecutionIds: ReadonlySet<string>;
  /** Bumps whenever a scheduled run ends: reload anything that lists runs. */
  finishedTick: number;
  subscribe: (listener: FinishedListener) => () => void;
}

/**
 * Lets the window know what the background scheduler is doing, without a
 * stream or an open connection: one tiny request every few seconds, and only
 * while the window is visible (a hidden window has nobody to tell).
 */
export function useScheduleActivity(
  nameOf: (executionId: number) => string | undefined,
): ScheduleActivityView {
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set());
  const [finishedTick, setFinishedTick] = useState(0);
  const nameRef = useRef(nameOf);
  const listeners = useRef(new Set<FinishedListener>());

  useEffect(() => {
    nameRef.current = nameOf;
  });

  const subscribe = useCallback((listener: FinishedListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let state: ActivityState = INITIAL_ACTIVITY;

    async function surface(run: FinishedScheduleRun) {
      const handled = await Promise.all(
        [...listeners.current].map(async (listener) => {
          try {
            return await listener(run);
          } catch {
            return false;
          }
        }),
      );
      if (handled.some(Boolean)) return;

      const name = nameRef.current(run.executionId) ?? `Execution ${run.executionId}`;
      if (run.status === "ok") {
        reportSuccess("Scheduled run finished", name);
      } else if (run.status === "failed") {
        reportError([
          `Scheduled run of "${name}" failed` + (run.error ? `: ${run.error}` : "."),
        ]);
      }
    }

    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const { data } = await getScheduleActivity(nextSince(state));
          if (cancelled) return;
          if (data) {
            const ids = data.running.map((r) => String(r.executionId));
            setRunningIds((prev) =>
              prev.size === ids.length && ids.every((id) => prev.has(id))
                ? prev
                : new Set(ids),
            );

            const out = reactToActivity(state, data);
            state = out.state;
            if (out.fresh.length > 0) setFinishedTick((tick) => tick + 1);
            for (const run of out.fresh) await surface(run);
          }
        } catch {
          // The backend may be restarting; the next tick tries again.
        }
      }
      if (!cancelled) timer = setTimeout(poll, ACTIVITY_POLL_MS);
    }

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void poll();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return { runningExecutionIds: runningIds, finishedTick, subscribe };
}
