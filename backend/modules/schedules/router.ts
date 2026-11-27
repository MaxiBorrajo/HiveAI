import { Hono } from "hono";
import { AppError, parseId } from "../../core/api/errors.ts";
import { ResponseBuilder } from "../../core/api/response.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import { upcomingRuns } from "./lib/next-run.ts";
import { ExecutionRepository } from "../../infrastructure/db/repositories/execution-repository.ts";
import { ScheduleRepository } from "../../infrastructure/db/repositories/schedule-repository.ts";
import {
  createSchedule,
  deleteSchedule,
  normalise,
  updateSchedule,
  inputIsRequired,
} from "./schedule-service.ts";

export const schedulesRouter = new Hono();

async function requireExecution(executionId: number) {
  if (!(await new ExecutionRepository(getORM()).findById(executionId))) {
    throw new AppError("Execution not found", 404);
  }
}

/** Validates a timing and shows when it would fire next (no execution needed). */
schedulesRouter.post("/preview", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const timing = normalise(body);
  return ResponseBuilder.success({
    nextRuns: upcomingRuns(timing, Date.now(), 5),
  });
});

/**
 * What the UI polls to know a scheduled run is in flight or has just ended:
 * the runs in progress, and (given `since`, a time in ms) every run that ended
 * since then. Kept tiny on purpose: it is hit every few seconds while the
 * window is visible. `serverTime` lets the client keep its own cursor without
 * trusting its clock.
 */
schedulesRouter.get("/activity", async (c) => {
  const serverTime = Date.now();
  const since = Number(c.req.query("since"));
  const repo = new ScheduleRepository(getORM());
  const [running, finished] = await Promise.all([
    repo.listRunning(),
    Number.isFinite(since) && c.req.query("since")
      ? repo.finishedSince(since)
      : Promise.resolve([]),
  ]);
  return ResponseBuilder.success({
    serverTime,
    running: running.map((r) => ({
      id: r.id,
      executionId: r.executionId,
      startedAt: r.startedAt,
    })),
    finished: finished.map((r) => ({
      id: r.id,
      executionId: r.executionId,
      status: r.status,
      error: r.error,
      finishedAt: r.finishedAt,
    })),
  });
});

schedulesRouter.get("/executions/:id", async (c) => {
  const executionId = parseId(c.req.param("id"));
  await requireExecution(executionId);
  const db = getORM();
  const repo = new ScheduleRepository(db);
  return ResponseBuilder.success({
    schedules: await repo.listByExecution(executionId),
    runs: await repo.listRuns(executionId),
    inputRequired: await inputIsRequired(db, executionId),
  });
});

schedulesRouter.post("/executions/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const created = await createSchedule(
    getORM(),
    parseId(c.req.param("id")),
    body,
  );
  return ResponseBuilder.success(created, { status: 201 });
});

schedulesRouter.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return ResponseBuilder.success(
    await updateSchedule(getORM(), parseId(c.req.param("id")), body),
  );
});

schedulesRouter.delete("/:id", async (c) => {
  await deleteSchedule(getORM(), parseId(c.req.param("id")));
  return ResponseBuilder.success({ deleted: true });
});

schedulesRouter.post("/runs/:id/dismiss", async (c) => {
  const repo = new ScheduleRepository(getORM());
  const id = parseId(c.req.param("id"));
  if (!(await repo.findRunById(id))) throw new AppError("Run not found", 404);
  await repo.updateRun(id, { acknowledged: true });
  return ResponseBuilder.success({ dismissed: true });
});
