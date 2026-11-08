import type { ScheduleRepository } from "../../infrastructure/db/repositories/schedule-repository.ts";
import type { Schedule } from "../../infrastructure/db/schema/schedules.ts";
import type { RunOutcome } from "./lib/consume-run.ts";
import {
  computeNextRun,
  slotsBetween,
  type ScheduleTiming,
} from "./lib/next-run.ts";

/** A slot older than this when we notice it is reported, not run. */
export const GRACE_MS = 2 * 60_000;
export const TICK_MS = 10_000;

export type AttentionEvent =
  | { kind: "missed"; executionId: number; missedCount: number }
  | { kind: "failed"; executionId: number; error: string };

export interface SchedulerDeps {
  repo: ScheduleRepository;
  /** Runs the execution unattended and reports how it ended. */
  runExecution: (schedule: Schedule) => Promise<RunOutcome>;
  /** Why this execution can't run on its own right now, or null. */
  checkRunnable: (schedule: Schedule) => Promise<string | null>;
  now?: () => number;
  /** Something the user should look at (shown even if the window is hidden). */
  onAttention?: (event: AttentionEvent) => void;
}

export interface Scheduler {
  /** Handles everything that is due. Resolves once runs are *started*. */
  tick(): Promise<void>;
  /** Resolves when every run started so far has finished. */
  whenIdle(): Promise<void>;
  /** Begins polling every `ms`. */
  start(ms: number): void;
  stop(): void;
}

function timingOf(schedule: Schedule): ScheduleTiming {
  return {
    frequency: schedule.frequency,
    timeOfDay: schedule.timeOfDay,
    daysOfWeek: schedule.daysOfWeek,
    cron: schedule.cron,
  };
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const now = deps.now ?? Date.now;
  const inFlight = new Set<Promise<void>>();
  let ticking = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function recordMissed(schedule: Schedule, at: number) {
    const timing = timingOf(schedule);
    const { count, last } = slotsBetween(timing, schedule.nextRunAt - 1, at);
    await deps.repo.createRun({
      scheduleId: schedule.id,
      executionId: schedule.executionId,
      scheduledFor: last || schedule.nextRunAt,
      status: "missed",
      missedCount: Math.max(count, 1),
      startedAt: at,
      finishedAt: at,
    });
    deps.onAttention?.({
      kind: "missed",
      executionId: schedule.executionId,
      missedCount: Math.max(count, 1),
    });
  }

  async function execute(schedule: Schedule, runId: number) {
    let outcome: RunOutcome;
    try {
      outcome = await deps.runExecution(schedule);
    } catch (error) {
      outcome = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const finishedAt = now();
    if (outcome.ok) {
      await deps.repo.updateRun(runId, {
        status: "ok",
        historyId: outcome.historyId,
        finishedAt,
      });
    } else {
      await deps.repo.updateRun(runId, {
        status: "failed",
        error: outcome.error,
        finishedAt,
      });
      deps.onAttention?.({
        kind: "failed",
        executionId: schedule.executionId,
        error: outcome.error,
      });
    }
  }

  async function handle(schedule: Schedule) {
    const at = now();
    const slot = schedule.nextRunAt;
    // Move on before doing anything so a slow run is never fired twice.
    await deps.repo.update(schedule.id, {
      nextRunAt: computeNextRun(timingOf(schedule), at),
    });

    if (at - slot > GRACE_MS) {
      await recordMissed(schedule, at);
      return;
    }

    const skip = async (reason: string) => {
      await deps.repo.createRun({
        scheduleId: schedule.id,
        executionId: schedule.executionId,
        scheduledFor: slot,
        status: "skipped",
        error: reason,
        startedAt: at,
        finishedAt: at,
      });
    };

    if (await deps.repo.hasRunning(schedule.executionId)) {
      return await skip("This execution was still running.");
    }
    const blocked = await deps.checkRunnable(schedule);
    if (blocked) {
      deps.onAttention?.({
        kind: "failed",
        executionId: schedule.executionId,
        error: blocked,
      });
      return await skip(blocked);
    }

    const run = await deps.repo.createRun({
      scheduleId: schedule.id,
      executionId: schedule.executionId,
      scheduledFor: slot,
      status: "running",
      startedAt: at,
    });
    await deps.repo.update(schedule.id, { lastRunAt: at });

    const task = execute(schedule, run.id).catch((error) =>
      console.error("[Scheduler] Could not record a run:", error)
    ).finally(() => inFlight.delete(task));
    inFlight.add(task);
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      for (const schedule of await deps.repo.findDue(now())) {
        try {
          await handle(schedule);
        } catch (error) {
          console.error(`[Scheduler] Schedule ${schedule.id} failed:`, error);
        }
      }
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    async whenIdle() {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
    start(ms: number) {
      this.stop();
      timer = setInterval(() => void tick(), ms);
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}

export async function startScheduler(
  deps: SchedulerDeps,
  tickMs = TICK_MS,
): Promise<Scheduler> {
  await deps.repo.failStaleRuns((deps.now ?? Date.now)());
  const scheduler = createScheduler(deps);
  scheduler.start(tickMs);
  await scheduler.tick();
  return scheduler;
}
