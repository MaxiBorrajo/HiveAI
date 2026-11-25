import { assertEquals } from "@std/assert";
import { initORM } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/execution-repository.ts";
import { ScheduleRepository } from "../../../../infrastructure/db/repositories/schedule-repository.ts";

Deno.test("weekdays live in schedule_days, one row each, and come back sorted", async () => {
  const db = await initORM(await Deno.makeTempDir());
  const execution = await new ExecutionRepository(db).create({
    name: "flow",
    createdAt: 1,
    updatedAt: 1,
  });
  const repo = new ScheduleRepository(db);
  const created = await repo.create({
    executionId: execution.id,
    frequency: "weekly",
    timeOfDay: "10:00",
    cron: "",
    input: "",
    daysOfWeek: [5, 1, 3, 1],
    nextRunAt: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  assertEquals(created.daysOfWeek, [1, 3, 5]);

  await repo.update(created.id, { daysOfWeek: [0, 6] });
  assertEquals((await repo.findById(created.id))?.daysOfWeek, [0, 6]);

  // Changing something else leaves the weekdays alone.
  await repo.update(created.id, { enabled: false });
  assertEquals((await repo.listByExecution(execution.id))[0].daysOfWeek, [0, 6]);

  const rows = db.$client.prepare("SELECT count(*) AS n FROM schedule_days").get() as { n: number };
  assertEquals(rows.n, 2);
  await repo.delete(created.id);
  const after = db.$client.prepare("SELECT count(*) AS n FROM schedule_days").get() as { n: number };
  assertEquals(after.n, 0);
});
