import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FinishedScheduleRun, ScheduleActivity } from "../api/schedules";
import { ACTIVITY_POLL_MS, useScheduleActivity } from "./useScheduleActivity";

const { getScheduleActivity, reportSuccess, reportError } = vi.hoisted(() => ({
  getScheduleActivity: vi.fn(),
  reportSuccess: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("../api/schedules", () => ({ getScheduleActivity }));
vi.mock("@/lib/toastManager", () => ({ reportSuccess, reportError }));

let visibility: DocumentVisibilityState = "visible";
let clock = 1_000_000;

const run = (id: number, status: FinishedScheduleRun["status"] = "ok", error: string | null = null, executionId = 3): FinishedScheduleRun =>
  ({ id, executionId, status, error, finishedAt: clock });
/** Answers the next polls: time moves on by one poll each call. */
function reply(finished: FinishedScheduleRun[] = [], running: ScheduleActivity["running"] = []) {
  clock += ACTIVITY_POLL_MS;
  getScheduleActivity.mockResolvedValue({ success: true, data: { serverTime: clock, running, finished } });
}

const names = (id: number) => (id === 3 ? "Daily digest" : undefined);
const tick = (ms = ACTIVITY_POLL_MS) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  visibility = "visible";
  clock = 1_000_000;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useScheduleActivity", () => {
  it("reports what is running, and does not toast old runs on the first poll", async () => {
    reply([run(40)], [{ id: 9, executionId: 3, startedAt: 1 }]);
    const { result } = renderHook(() => useScheduleActivity(names));
    await tick(0);

    expect([...result.current.runningExecutionIds]).toEqual(["3"]);
    expect(result.current.finishedTick).toBe(0);
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(getScheduleActivity).toHaveBeenLastCalledWith(undefined);
  });

  it("asks only for what ended since, and a run that ends bumps the tick and toasts once", async () => {
    reply();
    const { result } = renderHook(() => useScheduleActivity(names));
    await tick(0);

    reply([run(41)]);
    await tick();
    expect(getScheduleActivity).toHaveBeenLastCalledWith(expect.any(Number));
    expect(result.current.finishedTick).toBe(1);
    expect(reportSuccess).toHaveBeenCalledWith("Scheduled run finished", "Daily digest");

    reply([run(41)]); // still inside the overlap window
    await tick();
    expect(result.current.finishedTick).toBe(1);
    expect(reportSuccess).toHaveBeenCalledTimes(1);
  });

  it("a failed run is reported as an error with its reason", async () => {
    reply();
    renderHook(() => useScheduleActivity(names));
    await tick(0);
    reply([run(2, "failed", "model offline")]);
    await tick();
    expect(reportError).toHaveBeenCalledWith(['Scheduled run of "Daily digest" failed: model offline']);
    expect(reportSuccess).not.toHaveBeenCalled();
  });

  it("missed and skipped runs refresh the lists but pop nothing", async () => {
    reply();
    const { result } = renderHook(() => useScheduleActivity(names));
    await tick(0);
    reply([run(2, "missed"), run(3, "skipped")]);
    await tick();
    expect(result.current.finishedTick).toBe(1);
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("every run that ends in the same window is delivered, not just the last", async () => {
    reply();
    const seen: number[] = [];
    const { result } = renderHook(() => useScheduleActivity(names));
    act(() => { result.current.subscribe((r) => { seen.push(r.executionId); return true; }); });
    await tick(0);
    reply([run(5, "ok", null, 1), run(6, "ok", null, 2), run(7, "failed", "x", 3)]);
    await tick();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("no toast when a listener already showed the result, a toast when none did", async () => {
    reply();
    const { result } = renderHook(() => useScheduleActivity(names));
    let unsubscribe = () => {};
    act(() => { unsubscribe = result.current.subscribe(async () => true); });
    await tick(0);

    reply([run(1)]);
    await tick();
    expect(reportSuccess).not.toHaveBeenCalled();

    act(() => unsubscribe());
    reply([run(2)]);
    await tick();
    expect(reportSuccess).toHaveBeenCalledTimes(1);
  });

  it("a listener that throws never breaks the others or the polling", async () => {
    reply();
    const { result } = renderHook(() => useScheduleActivity(names));
    act(() => {
      result.current.subscribe(() => { throw new Error("boom"); });
    });
    await tick(0);
    reply([run(1)]);
    await tick();
    expect(reportSuccess).toHaveBeenCalledTimes(1);
    reply([run(2)]);
    await tick();
    expect(reportSuccess).toHaveBeenCalledTimes(2);
  });

  it("falls back to the id when the execution is not in the list", async () => {
    reply();
    renderHook(() => useScheduleActivity(() => undefined));
    await tick(0);
    reply([run(2)]);
    await tick();
    expect(reportSuccess).toHaveBeenCalledWith("Scheduled run finished", "Execution 3");
  });

  it("polls on a timer, and stops when the component goes away", async () => {
    reply();
    const { unmount } = renderHook(() => useScheduleActivity(names));
    await tick(0);
    expect(getScheduleActivity).toHaveBeenCalledTimes(1);
    await tick();
    expect(getScheduleActivity).toHaveBeenCalledTimes(2);
    unmount();
    await tick(ACTIVITY_POLL_MS * 3);
    expect(getScheduleActivity).toHaveBeenCalledTimes(2);
  });

  it("asks nothing while the window is hidden, and catches up the moment it shows", async () => {
    reply();
    visibility = "hidden";
    renderHook(() => useScheduleActivity(names));
    await tick(ACTIVITY_POLL_MS * 3);
    expect(getScheduleActivity).not.toHaveBeenCalled();

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getScheduleActivity).toHaveBeenCalledTimes(1);
  });

  it("a failing request is ignored and polling carries on", async () => {
    getScheduleActivity.mockRejectedValueOnce(new Error("backend restarting"));
    const { result } = renderHook(() => useScheduleActivity(names));
    await tick(0);
    expect(reportError).not.toHaveBeenCalled();

    reply([], [{ id: 1, executionId: 3, startedAt: 1 }]);
    await tick();
    expect([...result.current.runningExecutionIds]).toEqual(["3"]);
  });
});
