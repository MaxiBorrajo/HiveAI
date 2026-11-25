import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import {
  type NewSchedule,
  type NewScheduleRun,
  type Schedule,
  type ScheduleRow,
  type ScheduleRun,
  scheduleDays,
  scheduleRuns,
  schedules,
} from "../schema/index.ts";

export class ScheduleRepository {
  constructor(private db: AppDatabase) {}

  /** Adds each schedule's weekdays, which live in schedule_days (1NF). */
  private async withDays(rows: ScheduleRow[]): Promise<Schedule[]> {
    if (rows.length === 0) return [];
    const days = await this.db.select().from(scheduleDays)
      .where(inArray(scheduleDays.scheduleId, rows.map((r) => r.id)));
    const byId = new Map<number, number[]>();
    for (const d of days) {
      byId.set(d.scheduleId, [...(byId.get(d.scheduleId) ?? []), d.dayOfWeek]);
    }
    return rows.map((row) => ({
      ...row,
      daysOfWeek: (byId.get(row.id) ?? []).sort((x, y) => x - y),
    }));
  }

  private async replaceDays(scheduleId: number, days: number[]): Promise<void> {
    await this.db.delete(scheduleDays).where(eq(scheduleDays.scheduleId, scheduleId));
    const unique = [...new Set(days)];
    if (unique.length > 0) {
      await this.db.insert(scheduleDays).values(
        unique.map((dayOfWeek) => ({ scheduleId, dayOfWeek })),
      );
    }
  }

  async findById(id: number): Promise<Schedule | undefined> {
    const rows = await this.db.select().from(schedules).where(
      eq(schedules.id, id),
    );
    return (await this.withDays(rows))[0];
  }

  async listByExecution(executionId: number): Promise<Schedule[]> {
    return await this.withDays(
      await this.db.select().from(schedules)
        .where(eq(schedules.executionId, executionId))
        .orderBy(schedules.id),
    );
  }

  async findDue(now: number): Promise<Schedule[]> {
    return await this.withDays(
      await this.db.select().from(schedules)
        .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)))
        .orderBy(schedules.nextRunAt),
    );
  }

  async create(data: NewSchedule): Promise<Schedule> {
    const { daysOfWeek = [], ...columns } = data;
    const [row] = await this.db.insert(schedules).values(columns).returning();
    await this.replaceDays(row.id, daysOfWeek);
    return (await this.findById(row.id))!;
  }

  async update(id: number, data: Partial<NewSchedule>): Promise<void> {
    const { daysOfWeek, ...columns } = data;
    await this.db.update(schedules)
      .set({ ...columns, updatedAt: Date.now() })
      .where(eq(schedules.id, id));
    if (daysOfWeek !== undefined) await this.replaceDays(id, daysOfWeek);
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(schedules).where(eq(schedules.id, id));
  }

  async createRun(data: NewScheduleRun): Promise<ScheduleRun> {
    const [row] = await this.db.insert(scheduleRuns).values(data).returning();
    return row;
  }

  async updateRun(id: number, data: Partial<NewScheduleRun>): Promise<void> {
    await this.db.update(scheduleRuns).set(data).where(
      eq(scheduleRuns.id, id),
    );
  }

  async findRunById(id: number): Promise<ScheduleRun | undefined> {
    const [row] = await this.db.select().from(scheduleRuns).where(
      eq(scheduleRuns.id, id),
    );
    return row;
  }

  async listRuns(executionId: number, limit = 100): Promise<ScheduleRun[]> {
    return await this.db.select().from(scheduleRuns)
      .where(eq(scheduleRuns.executionId, executionId))
      .orderBy(desc(scheduleRuns.startedAt), desc(scheduleRuns.id))
      .limit(limit);
  }

  /** Per execution, not per schedule: the same flow must never run twice at once. */
  async hasRunning(executionId: number): Promise<boolean> {
    const rows = await this.db.select({ id: scheduleRuns.id })
      .from(scheduleRuns)
      .where(
        and(
          eq(scheduleRuns.executionId, executionId),
          eq(scheduleRuns.status, "running"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listRunning(): Promise<ScheduleRun[]> {
    return await this.db.select().from(scheduleRuns)
      .where(eq(scheduleRuns.status, "running"));
  }

  /**
   * Runs that ended at or after `since`, oldest first. Ordered by when they
   * ended (ids follow when they *started*, so a slow run has an older id than
   * one that finished before it).
   */
  async finishedSince(since: number, limit = 50): Promise<ScheduleRun[]> {
    return await this.db.select().from(scheduleRuns)
      .where(
        and(ne(scheduleRuns.status, "running"), gte(scheduleRuns.finishedAt, since)),
      )
      .orderBy(scheduleRuns.finishedAt, scheduleRuns.id)
      .limit(limit);
  }

  /** A run left `running` by a process that died is not running any more. */
  async failStaleRuns(now: number): Promise<void> {
    await this.db.update(scheduleRuns)
      .set({
        status: "failed",
        error: "The app was closed while this run was in progress.",
        finishedAt: now,
      })
      .where(eq(scheduleRuns.status, "running"));
  }

  async listRunsByHistoryIds(historyIds: number[]): Promise<ScheduleRun[]> {
    if (historyIds.length === 0) return [];
    const wanted = new Set(historyIds);
    const rows = await this.db.select().from(scheduleRuns);
    return rows.filter((r) => r.historyId !== null && wanted.has(r.historyId));
  }
}
