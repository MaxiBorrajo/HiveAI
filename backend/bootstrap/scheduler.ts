import type { HiveMicrokernel } from "../core/microkernel/hive-microkernel.ts";
import type { AppDatabase } from "../infrastructure/db/orm.ts";
import { ScheduleRepository } from "../infrastructure/db/repositories/schedule-repository.ts";
import { runExecution } from "../modules/executions/use-cases/run-execution/run-execution.ts";
import { consumeRunResponse } from "../modules/schedules/lib/consume-run.ts";
import { whyNotSchedulable } from "../modules/schedules/schedule-service.ts";
import {
  type AttentionEvent,
  startScheduler,
} from "../modules/schedules/scheduler.ts";

function notify(event: AttentionEvent): void {
  const body = event.kind === "missed"
    ? `HiveAI was not running for ${event.missedCount} scheduled run(s). Open the app to review them.`
    : `A scheduled run failed: ${event.error}`;
  try {
    new Notification("HiveAI", { body });
  } catch {
    // Notifications are best effort; the run log in the app is the record.
  }
}

export function startAppScheduler(db: AppDatabase, hive: HiveMicrokernel) {
  return startScheduler({
    repo: new ScheduleRepository(db),
    checkRunnable: (schedule) =>
      whyNotSchedulable(db, schedule.executionId, schedule.input),
    runExecution: async (schedule) =>
      consumeRunResponse(
        await runExecution(
          db,
          hive,
          schedule.executionId,
          schedule.input.trim() ? { input: schedule.input } : undefined,
          {},
          true,
          undefined,
          [],
          true,
        ),
      ),
    onAttention: notify,
  });
}
