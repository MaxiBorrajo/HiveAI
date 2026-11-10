import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { executions } from "./executions.ts";

export type ScheduleFrequency = "daily" | "weekly" | "cron";

export type ScheduleRunStatus =
  | "running"
  | "ok"
  | "failed"
  | "missed"
  | "skipped";

export const schedules = sqliteTable("schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  executionId: integer("executionId")
    .notNull()
    .references((): AnySQLiteColumn => executions.id, { onDelete: "cascade" }),
  frequency: text("frequency").$type<ScheduleFrequency>().notNull(),
  /** Local wall-clock time, "HH:MM". */
  timeOfDay: text("timeOfDay").notNull(),
  /** 5-field cron expression; only meaningful when frequency is "cron". */
  cron: text("cron").notNull().default(""),
  /** 0 (Sunday) - 6 (Saturday). Only meaningful for weekly schedules. */
  daysOfWeek: text("daysOfWeek", { mode: "json" }).$type<number[]>().notNull(),
  /** Fixed `input` handed to every run, so nobody has to type it at 10:00. */
  input: text("input").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  nextRunAt: integer("nextRunAt").notNull(),
  lastRunAt: integer("lastRunAt"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
});

export const scheduleRuns = sqliteTable("schedule_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scheduleId: integer("scheduleId")
    .notNull()
    .references((): AnySQLiteColumn => schedules.id, { onDelete: "cascade" }),
  /** Denormalised so the log survives the schedule being edited. */
  executionId: integer("executionId")
    .notNull()
    .references((): AnySQLiteColumn => executions.id, { onDelete: "cascade" }),
  /** The slot this entry is about (for `missed`, the latest missed slot). */
  scheduledFor: integer("scheduledFor").notNull(),
  status: text("status").$type<ScheduleRunStatus>().notNull(),
  historyId: integer("historyId"),
  missedCount: integer("missedCount").notNull().default(0),
  error: text("error"),
  acknowledged: integer("acknowledged", { mode: "boolean" })
    .notNull()
    .default(false),
  startedAt: integer("startedAt").notNull(),
  finishedAt: integer("finishedAt"),
});

export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type ScheduleRun = typeof scheduleRuns.$inferSelect;
export type NewScheduleRun = typeof scheduleRuns.$inferInsert;
