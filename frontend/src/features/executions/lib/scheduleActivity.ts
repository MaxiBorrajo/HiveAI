import type { FinishedScheduleRun, ScheduleActivity } from "../api/schedules";

/**
 * Each poll asks "what ended since T". T is not simply the last answer's time:
 * a run stamps its end a moment before it is saved, so a poll can miss one
 * that lands just behind it. Asking from a little earlier (and remembering the
 * ids already handled) closes that gap without ever replaying old runs.
 */
export const OVERLAP_MS = 30_000;
const MAX_REMEMBERED = 200;

export interface ActivityState {
  /** Server time of the first answer: nothing before it is ever reported. */
  baseline: number | null;
  /** Server time of the latest answer. */
  lastServerTime: number | null;
  /** Ids already handled, newest last. */
  seen: number[];
}

export const INITIAL_ACTIVITY: ActivityState = {
  baseline: null,
  lastServerTime: null,
  seen: [],
};

/** The `since` to send with the next request (undefined on the very first). */
export function nextSince(state: ActivityState): number | undefined {
  if (state.baseline === null || state.lastServerTime === null) return undefined;
  return Math.max(state.baseline, state.lastServerTime - OVERLAP_MS);
}

/**
 * Takes a poll's answer and returns the runs that are genuinely new. The first
 * answer only sets the baseline, so opening the app never replays old runs.
 */
export function reactToActivity(
  state: ActivityState,
  snapshot: ScheduleActivity,
): { state: ActivityState; fresh: FinishedScheduleRun[] } {
  if (state.baseline === null) {
    return {
      state: {
        baseline: snapshot.serverTime,
        lastServerTime: snapshot.serverTime,
        seen: [],
      },
      fresh: [],
    };
  }
  const known = new Set(state.seen);
  const fresh = snapshot.finished.filter(
    (run) => !known.has(run.id) && run.finishedAt >= state.baseline!,
  );
  return {
    state: {
      baseline: state.baseline,
      lastServerTime: snapshot.serverTime,
      seen: [...state.seen, ...fresh.map((run) => run.id)].slice(-MAX_REMEMBERED),
    },
    fresh,
  };
}

/**
 * Whether the finished run should pop the result open: it succeeded and it is
 * the execution the person is looking at. Anything else gets a toast instead.
 */
export function shouldOpenResult(
  run: Pick<FinishedScheduleRun, "status" | "executionId">,
  activeExecutionId: string | number | null,
): boolean {
  return run.status === "ok" && sameExecution(run.executionId, activeExecutionId);
}

/**
 * Execution ids arrive from the backend as numbers, but the screen types (and
 * sometimes passes) them as strings, so `130 === "130"` is a trap. Compare ids
 * only through this.
 */
export function sameExecution(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): boolean {
  return a != null && b != null && String(a) === String(b);
}
