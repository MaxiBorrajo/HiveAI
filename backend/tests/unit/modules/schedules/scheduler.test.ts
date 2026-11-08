import { assertEquals, assertRejects } from "@std/assert";
import { initORM } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/execution-repository.ts";
import { ScheduleRepository } from "../../../../infrastructure/db/repositories/schedule-repository.ts";
import { AppError } from "../../../../core/api/errors.ts";
import {
  createScheduler,
  GRACE_MS,
  type AttentionEvent,
} from "../../../../modules/schedules/scheduler.ts";
import {
  createSchedule,
  updateSchedule,
} from "../../../../modules/schedules/schedule-service.ts";
import type { RunOutcome } from "../../../../modules/schedules/lib/consume-run.ts";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

async function setup(inputRequired = false) {
  const db = await initORM(await Deno.makeTempDir());
  const executions = new ExecutionRepository(db);
  const now = Date.now();
  const execution = await executions.create({
    name: "sched",
    createdAt: now,
    updatedAt: now,
  });
  const graph = await executions.createGraph({
    executionId: execution.id,
    graph: JSON.stringify({ nodes: [], edges: [] }),
    state: JSON.stringify({ input: { type: "string", required: inputRequired } }),
    createdAt: now,
  });
  await executions.update(execution.id, { lastGraphId: graph.id });
  return { db, repo: new ScheduleRepository(db), executionId: execution.id };
}

// initORM is a process singleton, so every test shares one DB: only look at
// this test's own execution.
function scoped(repo: ScheduleRepository, executionId: number) {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop === "findDue") {
        return async (now: number) =>
          (await target.findDue(now)).filter((x) => x.executionId === executionId);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function harness(
  s: { repo: ScheduleRepository; executionId: number },
  clock: { t: number },
  outcome: () => Promise<RunOutcome> = () =>
    Promise.resolve({ ok: true, historyId: 42 }),
  blocked: string | null = null,
) {
  const runs: number[] = [];
  const attention: AttentionEvent[] = [];
  const scheduler = createScheduler({
    repo: scoped(s.repo, s.executionId),
    now: () => clock.t,
    runExecution: (schedule) => {
      runs.push(schedule.executionId);
      return outcome();
    },
    checkRunnable: () => Promise.resolve(blocked),
    onAttention: (e) => attention.push(e),
  });
  return { scheduler, runs, attention };
}

async function scheduleDaily(
  s: Awaited<ReturnType<typeof setup>>,
  createdAt: number,
) {
  const schedule = await s.repo.create({
    executionId: s.executionId,
    frequency: "daily",
    timeOfDay: "10:00",
    daysOfWeek: [],
    nextRunAt: at(8, 10),
    createdAt,
    updatedAt: createdAt,
  });
  return schedule;
}

Deno.test("nothing runs before the slot", async () => {
  const s = await setup();
  const schedule = await scheduleDaily(s, at(7, 9));
  const clock = { t: at(8, 9, 59) };
  const h = harness(s, clock);
  await h.scheduler.tick();
  assertEquals(h.runs, []);
  assertEquals((await s.repo.findById(schedule.id))?.nextRunAt, at(8, 10));
});

Deno.test("a due slot within the grace period runs and is logged", async () => {
  const s = await setup();
  const schedule = await scheduleDaily(s, at(7, 9));
  const clock = { t: at(8, 10, 1) };
  const h = harness(s, clock);
  await h.scheduler.tick();
  await h.scheduler.whenIdle();

  assertEquals(h.runs, [s.executionId]);
  const [run] = await s.repo.listRuns(s.executionId);
  assertEquals(run.status, "ok");
  assertEquals(run.historyId, 42);
  assertEquals(run.scheduledFor, at(8, 10));
  const updated = await s.repo.findById(schedule.id);
  assertEquals(updated?.nextRunAt, at(9, 10));
  assertEquals(updated?.lastRunAt, at(8, 10, 1));

  await h.scheduler.tick();
  await h.scheduler.whenIdle();
  assertEquals(h.runs.length, 1, "the same slot is never run twice");
});

Deno.test("a slot older than the grace period is reported and NOT run", async () => {
  const s = await setup();
  const schedule = await scheduleDaily(s, at(7, 9));
  // App was closed over 3 slots (8, 9, 10 at 10:00) and reopened at 10:30.
  const clock = { t: at(10, 10, 30) };
  const h = harness(s, clock);
  await h.scheduler.tick();
  await h.scheduler.whenIdle();

  assertEquals(h.runs, [], "no silent catch-up run");
  const [run] = await s.repo.listRuns(s.executionId);
  assertEquals(run.status, "missed");
  assertEquals(run.missedCount, 3);
  assertEquals(run.scheduledFor, at(10, 10));
  assertEquals(run.acknowledged, false);
  assertEquals(h.attention, [{ kind: "missed", executionId: s.executionId, missedCount: 3 }]);
  assertEquals((await s.repo.findById(schedule.id))?.nextRunAt, at(11, 10));
});

Deno.test("grace boundary: exactly GRACE_MS late still runs", async () => {
  const s = await setup();
  await scheduleDaily(s, at(7, 9));
  const clock = { t: at(8, 10) + GRACE_MS };
  const h = harness(s, clock);
  await h.scheduler.tick();
  await h.scheduler.whenIdle();
  assertEquals(h.runs.length, 1);
});

Deno.test("a paused schedule never runs", async () => {
  const s = await setup();
  const schedule = await scheduleDaily(s, at(7, 9));
  await s.repo.update(schedule.id, { enabled: false });
  const h = harness(s, { t: at(8, 10, 1) });
  await h.scheduler.tick();
  assertEquals(h.runs, []);
  assertEquals(await s.repo.listRuns(s.executionId), []);
});

Deno.test("a failed run is logged with its error and flagged", async () => {
  const s = await setup();
  await scheduleDaily(s, at(7, 9));
  const h = harness(s, { t: at(8, 10, 1) }, () =>
    Promise.resolve({ ok: false, error: "model offline" }));
  await h.scheduler.tick();
  await h.scheduler.whenIdle();
  const [run] = await s.repo.listRuns(s.executionId);
  assertEquals(run.status, "failed");
  assertEquals(run.error, "model offline");
  assertEquals(h.attention[0]?.kind, "failed");
});

Deno.test("a throwing run is recorded as failed, not lost", async () => {
  const s = await setup();
  await scheduleDaily(s, at(7, 9));
  const h = harness(s, { t: at(8, 10, 1) }, () => Promise.reject(new Error("boom")));
  await h.scheduler.tick();
  await h.scheduler.whenIdle();
  const [run] = await s.repo.listRuns(s.executionId);
  assertEquals(run.status, "failed");
  assertEquals(run.error, "boom");
});

Deno.test("overlap: a slot is skipped while the previous run is still going", async () => {
  const s = await setup();
  const schedule = await scheduleDaily(s, at(7, 9));
  let release!: () => void;
  const gate = new Promise<RunOutcome>((r) => release = () => r({ ok: true, historyId: 1 }));
  const clock = { t: at(8, 10, 1) };
  const h = harness(s, clock, () => gate);
  await h.scheduler.tick();

  await s.repo.update(schedule.id, { nextRunAt: at(8, 10, 1) });
  clock.t = at(8, 10, 2);
  await h.scheduler.tick();
  release();
  await h.scheduler.whenIdle();

  assertEquals(h.runs.length, 1);
  const statuses = (await s.repo.listRuns(s.executionId)).map((r) => r.status).sort();
  assertEquals(statuses, ["ok", "skipped"]);
});

Deno.test("a blocked execution is skipped with the reason", async () => {
  const s = await setup();
  await scheduleDaily(s, at(7, 9));
  const h = harness(s, { t: at(8, 10, 1) }, undefined, "needs input");
  await h.scheduler.tick();
  assertEquals(h.runs, []);
  const [run] = await s.repo.listRuns(s.executionId);
  assertEquals(run.status, "skipped");
  assertEquals(run.error, "needs input");
});

Deno.test("runs left 'running' by a dead process become failed", async () => {
  const s = await setup();
  const schedule = await scheduleDaily(s, at(7, 9));
  const run = await s.repo.createRun({
    scheduleId: schedule.id,
    executionId: s.executionId,
    scheduledFor: at(8, 10),
    status: "running",
    startedAt: at(8, 10),
  });
  await s.repo.failStaleRuns(at(8, 12));
  assertEquals((await s.repo.findRunById(run.id))?.status, "failed");
});

Deno.test("createSchedule rejects a required input with no fixed input", async () => {
  const s = await setup(true);
  for (const input of [undefined, "", "   "]) {
    const error = await assertRejects(
      () => createSchedule(s.db, s.executionId, { frequency: "daily", timeOfDay: "10:00", input }),
      AppError,
    );
    assertEquals(error.status, 422);
  }
  assertEquals(await s.repo.listByExecution(s.executionId), []);
});

Deno.test("a required input is schedulable when the schedule carries a fixed input", async () => {
  const s = await setup(true);
  const created = await createSchedule(s.db, s.executionId, {
    frequency: "daily",
    timeOfDay: "10:00",
    input: "  summarise the news  ",
  });
  assertEquals(created.input, "summarise the news");
});

Deno.test("a fixed input is optional when the graph does not require one", async () => {
  const without = await setup(false);
  assertEquals((await createSchedule(without.db, without.executionId, { frequency: "daily", timeOfDay: "10:00" })).input, "");
  const other = await setup(false);
  const withInput = await createSchedule(other.db, other.executionId, { frequency: "daily", timeOfDay: "10:00", input: "hi" });
  assertEquals(withInput.input, "hi");
});

Deno.test("clearing the fixed input of a required-input schedule is refused while enabled", async () => {
  const s = await setup(true);
  const created = await createSchedule(s.db, s.executionId, { frequency: "daily", timeOfDay: "10:00", input: "go" });
  await assertRejects(() => updateSchedule(s.db, created.id, { input: "" }), AppError);
  assertEquals((await updateSchedule(s.db, created.id, { input: "new" })).input, "new");
  assertEquals((await s.repo.findById(created.id))?.input, "new");
});

Deno.test("createSchedule validates the timing and computes nextRunAt", async () => {
  const s = await setup();
  await assertRejects(
    () => createSchedule(s.db, s.executionId, { frequency: "weekly", timeOfDay: "10:00", daysOfWeek: [] }),
    AppError,
  );
  const created = await createSchedule(s.db, s.executionId, { frequency: "daily", timeOfDay: "10:00" });
  assertEquals(created.nextRunAt > Date.now(), true);
  assertEquals(created.enabled, true);
});

Deno.test("resuming a paused schedule restarts from now (no stale missed pile)", async () => {
  const s = await setup();
  const created = await createSchedule(s.db, s.executionId, { frequency: "daily", timeOfDay: "10:00", enabled: false });
  await s.repo.update(created.id, { nextRunAt: at(1, 10) });
  const resumed = await updateSchedule(s.db, created.id, { enabled: true });
  assertEquals(resumed.nextRunAt > Date.now(), true);
});

Deno.test("an execution that later requires input can't be resumed without a fixed input", async () => {
  const s = await setup();
  const created = await createSchedule(s.db, s.executionId, { frequency: "daily", timeOfDay: "10:00", enabled: false });
  const executions = new ExecutionRepository(s.db);
  const g = await executions.createGraph({
    executionId: s.executionId,
    graph: "{}",
    state: JSON.stringify({ input: { type: "string", required: true } }),
    createdAt: Date.now(),
  });
  await executions.update(s.executionId, { lastGraphId: g.id });
  await assertRejects(() => updateSchedule(s.db, created.id, { enabled: true }), AppError);
  const fixed = await updateSchedule(s.db, created.id, { enabled: true, input: "now has one" });
  assertEquals(fixed.enabled, true);
});

Deno.test("a cron schedule fires every slot, and missed 5-minute slots are counted not run", async () => {
  const s = await setup();
  const schedule = await s.repo.create({
    executionId: s.executionId,
    frequency: "cron",
    cron: "*/5 * * * *",
    timeOfDay: "00:00",
    daysOfWeek: [],
    nextRunAt: at(8, 10, 5),
    createdAt: at(8, 10),
    updatedAt: at(8, 10),
  });
  const clock = { t: at(8, 10, 5) };
  const h = harness(s, clock);
  await h.scheduler.tick();
  await h.scheduler.whenIdle();
  assertEquals(h.runs.length, 1);
  assertEquals((await s.repo.findById(schedule.id))?.nextRunAt, at(8, 10, 10));

  clock.t = at(8, 10, 10) + 1000;
  await h.scheduler.tick();
  await h.scheduler.whenIdle();
  assertEquals(h.runs.length, 2);

  // App closed for 50 minutes: 10 slots (10:15 .. 11:00) are reported, none run.
  clock.t = at(8, 11, 1);
  await h.scheduler.tick();
  await h.scheduler.whenIdle();
  assertEquals(h.runs.length, 2);
  const missed = (await s.repo.listRuns(s.executionId)).find((r) => r.status === "missed");
  assertEquals(missed?.missedCount, 10);
  assertEquals(missed?.scheduledFor, at(8, 11, 0));
});

Deno.test("createSchedule accepts a cron expression and rejects a bad one", async () => {
  const s = await setup();
  const created = await createSchedule(s.db, s.executionId, { frequency: "cron", cron: "  */5   * * * * " });
  assertEquals(created.cron, "*/5 * * * *");
  assertEquals(created.nextRunAt > Date.now() && created.nextRunAt - Date.now() <= 5 * 60_000, true);
  await assertRejects(() => createSchedule(s.db, s.executionId, { frequency: "cron", cron: "every 5 min" }), AppError);
});

Deno.test("editing a schedule from daily to cron restarts it from now", async () => {
  const s = await setup();
  const created = await createSchedule(s.db, s.executionId, { frequency: "daily", timeOfDay: "10:00" });
  const edited = await updateSchedule(s.db, created.id, { frequency: "cron", cron: "*/10 * * * *" });
  assertEquals(edited.frequency, "cron");
  assertEquals(edited.cron, "*/10 * * * *");
  assertEquals(edited.nextRunAt - Date.now() <= 10 * 60_000, true);
});

Deno.test("activity queries: running runs, and finished ones since a moment, by when they ENDED", async () => {
  const s = await setup();
  const schedule = await scheduleDaily(s, at(7, 9));
  const mine = <T extends { executionId: number }>(rows: T[]) => rows.filter((r) => r.executionId === s.executionId);
  const make = (status: "running" | "ok" | "failed", startedAt: number, finishedAt?: number) =>
    s.repo.createRun({
      scheduleId: schedule.id,
      executionId: s.executionId,
      scheduledFor: startedAt,
      status,
      startedAt,
      finishedAt,
    });

  // A slow run starts first (lower id) but ends LAST.
  const slow = await make("running", at(8, 10));
  assertEquals(mine(await s.repo.listRunning()).map((r) => r.id), [slow.id]);
  const quick = await make("ok", at(8, 10, 1), at(8, 10, 2));
  assertEquals(mine(await s.repo.finishedSince(at(8, 10))).map((r) => r.id), [quick.id], "running runs are not 'finished'");

  await s.repo.updateRun(slow.id, { status: "failed", error: "x", finishedAt: at(8, 10, 30) });
  assertEquals(mine(await s.repo.listRunning()), []);
  assertEquals(
    mine(await s.repo.finishedSince(at(8, 10))).map((r) => r.id),
    [quick.id, slow.id],
    "ordered by end time, so a slow run with an older id still arrives after",
  );
  assertEquals(mine(await s.repo.finishedSince(at(8, 10, 3))).map((r) => r.id), [slow.id]);
  assertEquals(mine(await s.repo.finishedSince(at(8, 10, 31))), []);
});

Deno.test("an execution gets one schedule: a second is refused, the first stays", async () => {
  const s = await setup();
  const first = await createSchedule(s.db, s.executionId, { frequency: "daily", timeOfDay: "10:00" });
  const error = await assertRejects(
    () => createSchedule(s.db, s.executionId, { frequency: "cron", cron: "*/5 * * * *" }),
    AppError,
    "already has a schedule",
  );
  assertEquals(error.status, 409);
  const all = await s.repo.listByExecution(s.executionId);
  assertEquals(all.map((x) => x.id), [first.id]);

  // After deleting it, a new one is allowed.
  await s.repo.delete(first.id);
  await createSchedule(s.db, s.executionId, { frequency: "daily", timeOfDay: "11:00" });
});

Deno.test("two legacy schedules of one execution never run it twice at once", async () => {
  const s = await setup();
  const base = {
    executionId: s.executionId,
    frequency: "daily" as const,
    timeOfDay: "10:00",
    daysOfWeek: [],
    nextRunAt: at(8, 10),
    createdAt: at(7, 9),
    updatedAt: at(7, 9),
  };
  await s.repo.create(base);
  await s.repo.create(base);

  let release!: () => void;
  const gate = new Promise<RunOutcome>((r) => release = () => r({ ok: true, historyId: 1 }));
  const h = harness(s, { t: at(8, 10, 1) }, () => gate);
  await h.scheduler.tick();
  release();
  await h.scheduler.whenIdle();

  assertEquals(h.runs.length, 1, "the second schedule's slot is skipped, not run in parallel");
  const statuses = (await s.repo.listRuns(s.executionId)).map((r) => r.status).sort();
  assertEquals(statuses, ["ok", "skipped"]);
});
