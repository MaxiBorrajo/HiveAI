import { describe, expect, it } from "vitest";
import {
  applyMode,
  canAdvance,
  wizardSteps,
  DEFAULT_DRAFT,
  describeCron,
  describeSchedule,
  intervalCron,
  modeOf,
  isDraftValid,
  pendingMissed,
  toggleDay,
  totalMissed,
} from "./schedule";
import type { ScheduleRun } from "../types";

const run = (over: Partial<ScheduleRun>): ScheduleRun => ({
  id: 1,
  scheduleId: 1,
  executionId: 1,
  scheduledFor: 0,
  status: "ok",
  historyId: null,
  missedCount: 0,
  error: null,
  acknowledged: false,
  startedAt: 0,
  finishedAt: null,
  ...over,
});

describe("describeSchedule", () => {
  it("describes daily and weekly schedules", () => {
    expect(
      describeSchedule({ frequency: "daily", timeOfDay: "10:00", daysOfWeek: [], cron: "" }),
    ).toBe("Every day at 10:00");
    expect(
      describeSchedule({ frequency: "weekly", timeOfDay: "08:30", daysOfWeek: [3, 1], cron: "" }),
    ).toBe("Every Mon, Wed at 08:30");
  });
});

describe("toggleDay", () => {
  it("adds in order and removes", () => {
    expect(toggleDay([1, 5], 3)).toEqual([1, 3, 5]);
    expect(toggleDay([1, 3, 5], 3)).toEqual([1, 5]);
  });
});

describe("isDraftValid", () => {
  it("needs a valid time and, for weekly, at least one day", () => {
    expect(isDraftValid({ frequency: "daily", timeOfDay: "10:00", daysOfWeek: [], cron: "", input: "" })).toBe(true);
    expect(isDraftValid({ frequency: "daily", timeOfDay: "", daysOfWeek: [], cron: "", input: "" })).toBe(false);
    expect(isDraftValid({ frequency: "weekly", timeOfDay: "10:00", daysOfWeek: [], cron: "", input: "" })).toBe(false);
    expect(isDraftValid({ frequency: "weekly", timeOfDay: "10:00", daysOfWeek: [2], cron: "", input: "" })).toBe(true);
    const daily = { frequency: "daily" as const, timeOfDay: "10:00", daysOfWeek: [] as number[], cron: "" };
    expect(isDraftValid({ ...daily, input: "" }, true)).toBe(false);
    expect(isDraftValid({ ...daily, input: "   " }, true)).toBe(false);
    expect(isDraftValid({ ...daily, input: "go" }, true)).toBe(true);
  });
});

describe("missed runs", () => {
  const runs = [
    run({ id: 1, status: "missed", missedCount: 2 }),
    run({ id: 2, status: "missed", missedCount: 1, acknowledged: true }),
    run({ id: 3, status: "ok" }),
  ];
  it("only counts unacknowledged missed runs", () => {
    expect(pendingMissed(runs).map((r) => r.id)).toEqual([1]);
    expect(totalMissed(runs)).toBe(2);
  });
});

describe("cron schedules", () => {
  it("reads a cron expression in plain language", () => {
    expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
    expect(describeCron("0 9 * * 1-5")).toMatch(/09:00.*Monday through Friday/);
    expect(describeCron("not cron")).toBeNull();
    expect(
      describeSchedule({ frequency: "cron", timeOfDay: "00:00", daysOfWeek: [], cron: "*/15 * * * *" }),
    ).toBe("Every 15 minutes");
    expect(
      describeSchedule({ frequency: "cron", timeOfDay: "00:00", daysOfWeek: [], cron: "garbage" }),
    ).toBe("garbage");
  });

  it("builds interval crons", () => {
    expect(intervalCron("minutes", 5)).toBe("*/5 * * * *");
    expect(intervalCron("hours", 6)).toBe("0 */6 * * *");
  });

  it("maps a saved schedule back to the friendly mode it came from", () => {
    expect(modeOf({ frequency: "daily", cron: "" }).mode).toBe("daily");
    expect(modeOf({ frequency: "weekly", cron: "" }).mode).toBe("weekly");
    expect(modeOf({ frequency: "cron", cron: "*/10 * * * *" })).toEqual({ mode: "minutes", every: 10 });
    expect(modeOf({ frequency: "cron", cron: " 0  */6 * * * " })).toEqual({ mode: "hours", every: 6 });
    // not one of the offered steps, or not an interval at all: edit it as cron
    expect(modeOf({ frequency: "cron", cron: "*/7 * * * *" }).mode).toBe("custom");
    expect(modeOf({ frequency: "cron", cron: "0 9 * * 1-5" }).mode).toBe("custom");
  });

  it("applyMode turns interval modes into a cron schedule and keeps the rest", () => {
    const d = { ...DEFAULT_DRAFT, input: "keep me" };
    expect(applyMode(d, "minutes", 5)).toMatchObject({ frequency: "cron", cron: "*/5 * * * *", input: "keep me" });
    expect(applyMode(d, "hours", 2)).toMatchObject({ frequency: "cron", cron: "0 */2 * * *" });
    expect(applyMode(d, "daily", 5).frequency).toBe("daily");
    expect(applyMode(d, "custom", 5)).toMatchObject({ frequency: "cron", cron: d.cron });
  });

  it("a cron draft needs exactly 5 fields", () => {
    const cron = { ...DEFAULT_DRAFT, frequency: "cron" as const };
    expect(isDraftValid({ ...cron, cron: "*/5 * * * *" })).toBe(true);
    expect(isDraftValid({ ...cron, cron: "*/5 * * *" })).toBe(false);
    expect(isDraftValid({ ...cron, cron: "" })).toBe(false);
  });
});

describe("wizard steps", () => {
  it("walks when -> input -> settings -> accept only as far as each applies", () => {
    expect(wizardSteps({ creating: true, inputRequired: true, needsSettings: true }))
      .toEqual(["when", "input", "settings", "accept"]);
    expect(wizardSteps({ creating: true, inputRequired: false, needsSettings: true }))
      .toEqual(["when", "settings", "accept"]);
    expect(wizardSteps({ creating: true, inputRequired: true, needsSettings: false }))
      .toEqual(["when", "input", "accept"]);
    expect(wizardSteps({ creating: true, inputRequired: false, needsSettings: false }))
      .toEqual(["when", "accept"]);
  });

  it("editing never asks for settings or the approval warning again", () => {
    expect(wizardSteps({ creating: false, inputRequired: false, needsSettings: true }))
      .toEqual(["when"]);
    expect(wizardSteps({ creating: false, inputRequired: true, needsSettings: true }))
      .toEqual(["when", "input"]);
  });

  it("you cannot leave 'when' with a problem, nor 'input' while it is required and empty", () => {
    expect(canAdvance("when", DEFAULT_DRAFT, false, null)).toBe(true);
    expect(canAdvance("when", DEFAULT_DRAFT, false, "Minute must be between 0 and 59.")).toBe(false);
    expect(canAdvance("when", { ...DEFAULT_DRAFT, frequency: "weekly", daysOfWeek: [] }, false, null)).toBe(false);
    expect(canAdvance("input", DEFAULT_DRAFT, true, null)).toBe(false);
    expect(canAdvance("input", { ...DEFAULT_DRAFT, input: "  " }, true, null)).toBe(false);
    expect(canAdvance("input", { ...DEFAULT_DRAFT, input: "go" }, true, null)).toBe(true);
    expect(canAdvance("settings", DEFAULT_DRAFT, false, null)).toBe(true);
  });
});
