import { describe, expect, it } from "vitest";
import {
  INITIAL_ACTIVITY,
  OVERLAP_MS,
  nextSince,
  reactToActivity,
  sameExecution,
  shouldOpenResult,
  type ActivityState,
} from "./scheduleActivity";
import type { FinishedScheduleRun, ScheduleActivity } from "../api/schedules";

const run = (id: number, finishedAt: number, status: FinishedScheduleRun["status"] = "ok", executionId = 7): FinishedScheduleRun =>
  ({ id, executionId, status, error: null, finishedAt });
const snap = (serverTime: number, finished: FinishedScheduleRun[] = [], running: ScheduleActivity["running"] = []): ScheduleActivity =>
  ({ serverTime, running, finished });

function start(serverTime = 1_000_000): ActivityState {
  return reactToActivity(INITIAL_ACTIVITY, snap(serverTime)).state;
}

describe("reactToActivity", () => {
  it("the first answer only sets the baseline: nothing is replayed, and the first request has no 'since'", () => {
    expect(nextSince(INITIAL_ACTIVITY)).toBeUndefined();
    const out = reactToActivity(INITIAL_ACTIVITY, snap(1_000_000, [run(1, 999_000)]));
    expect(out.fresh).toEqual([]);
    expect(out.state.baseline).toBe(1_000_000);
  });

  it("returns each finished run exactly once, even though polls overlap", () => {
    let state = start();
    const first = reactToActivity(state, snap(1_005_000, [run(2, 1_003_000)]));
    expect(first.fresh.map((r) => r.id)).toEqual([2]);
    state = first.state;

    // The next answer still contains run 2 (overlap window) plus a new one.
    const second = reactToActivity(state, snap(1_010_000, [run(2, 1_003_000), run(3, 1_008_000)]));
    expect(second.fresh.map((r) => r.id)).toEqual([3]);
    const third = reactToActivity(second.state, snap(1_015_000, [run(3, 1_008_000)]));
    expect(third.fresh).toEqual([]);
  });

  it("several runs ending between two polls are all reported (one per execution)", () => {
    const out = reactToActivity(start(), snap(1_005_000, [run(5, 1_002_000, "ok", 1), run(6, 1_003_000, "failed", 2), run(7, 1_004_000, "ok", 3)]));
    expect(out.fresh.map((r) => [r.executionId, r.status])).toEqual([[1, "ok"], [2, "failed"], [3, "ok"]]);
  });

  it("never reports a run that ended before the baseline, even if the overlap window reaches it", () => {
    const state = start(1_000_000);
    const out = reactToActivity(state, snap(1_005_000, [run(1, 990_000)]));
    expect(out.fresh).toEqual([]);
  });

  it("a slow run that ends after a quicker one with a newer id is still caught", () => {
    let state = start();
    state = reactToActivity(state, snap(1_005_000, [run(9, 1_002_000)])).state; // quick run, newer id
    const out = reactToActivity(state, snap(1_010_000, [run(9, 1_002_000), run(4, 1_007_000)])); // slow run, older id
    expect(out.fresh.map((r) => r.id)).toEqual([4]);
  });

  it("remembers a bounded number of ids", () => {
    let state = start();
    for (let i = 1; i <= 300; i++) {
      state = reactToActivity(state, snap(1_000_000 + i * 10, [run(i, 1_000_000 + i * 10)])).state;
    }
    expect(state.seen.length).toBeLessThanOrEqual(200);
    expect(state.seen.at(-1)).toBe(300);
  });
});

describe("nextSince", () => {
  it("asks from a little before the last answer, but never before the baseline", () => {
    let state = start(1_000_000);
    state = reactToActivity(state, snap(1_005_000)).state;
    expect(nextSince(state)).toBe(1_000_000); // 1_005_000 - 30_000 would predate the baseline
    state = reactToActivity(state, snap(1_100_000)).state;
    expect(nextSince(state)).toBe(1_100_000 - OVERLAP_MS);
  });
});

describe("shouldOpenResult", () => {
  it("opens only for a successful run of the execution being looked at", () => {
    expect(shouldOpenResult({ status: "ok", executionId: 7 }, "7")).toBe(true);
    expect(shouldOpenResult({ status: "ok", executionId: 7 }, "8")).toBe(false);
    expect(shouldOpenResult({ status: "ok", executionId: 7 }, null)).toBe(false);
    expect(shouldOpenResult({ status: "failed", executionId: 7 }, "7")).toBe(false);
    expect(shouldOpenResult({ status: "missed", executionId: 7 }, "7")).toBe(false);
  });
});

describe("execution ids that are numbers at runtime", () => {
  it("130 and \"130\" are the same execution, null/undefined never are", () => {
    expect(sameExecution(130, "130")).toBe(true);
    expect(sameExecution("130", 130)).toBe(true);
    expect(sameExecution(130, 131)).toBe(false);
    expect(sameExecution(null, null)).toBe(false);
    expect(sameExecution(undefined, "1")).toBe(false);
  });

  it("shouldOpenResult works when the active id is really a number", () => {
    const activeAsNumber = 7 as unknown as string;
    expect(shouldOpenResult({ status: "ok", executionId: 7 }, activeAsNumber)).toBe(true);
    expect(shouldOpenResult({ status: "ok", executionId: 7 }, 8)).toBe(false);
  });
});
