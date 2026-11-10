import type { HiveMicrokernel } from "../core/microkernel/hive-microkernel.ts";
import type { AppDatabase } from "../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../infrastructure/db/repositories/execution-repository.ts";
import { ScheduleRepository } from "../infrastructure/db/repositories/schedule-repository.ts";
import { runExecution } from "../modules/executions/use-cases/run-execution/run-execution.ts";
import { consumeRunResponse } from "../modules/schedules/lib/consume-run.ts";
import { whyNotSchedulable } from "../modules/schedules/schedule-service.ts";
import { notifyUser } from "./notify.ts";
import {
  type AttentionEvent,
  startScheduler,
} from "../modules/schedules/scheduler.ts";

function notify(event: AttentionEvent): void {
  const body = event.kind === "missed"
    ? `HiveAI was not running for ${event.missedCount} scheduled run(s). Open the app to review them.`
    : `A scheduled run failed: ${event.error}`;
  notifyUser("HiveAI", body);
}

async function executionName(db: AppDatabase, executionId: number): Promise<string> {
  const execution = await new ExecutionRepository(db).findById(executionId)
    .catch(() => undefined);
  return execution?.name?.trim() || "Your execution";
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
    onStarted: async ({ executionId }) => {
      notifyUser("HiveAI", `${await executionName(db, executionId)} started its scheduled run.`);
    },
    onCompleted: async ({ executionId }) => {
      const name = await executionName(db, executionId);
      notifyUser("HiveAI", `${name} finished its scheduled run. Open HiveAI to see the result.`);
    },
  });
}
