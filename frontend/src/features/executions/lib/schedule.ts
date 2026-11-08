import cronstrue from "cronstrue";
import type { Schedule, ScheduleDraft, ScheduleRun } from "../types";

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const DEFAULT_DRAFT: ScheduleDraft = {
  frequency: "daily",
  timeOfDay: "10:00",
  daysOfWeek: [1, 2, 3, 4, 5],
  cron: "*/5 * * * *",
  input: "",
};

/**
 * What the person picks in the form. Everything except "custom" is a friendly
 * way to produce a schedule without knowing cron.
 */
export type ScheduleMode = "minutes" | "hours" | "daily" | "weekly" | "custom";

export const MODE_LABEL: Record<ScheduleMode, string> = {
  minutes: "Every few minutes",
  hours: "Every few hours",
  daily: "Every day",
  weekly: "On certain days",
  custom: "Custom (cron)",
};

export const MINUTE_STEPS = [1, 2, 5, 10, 15, 20, 30];
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];

const MINUTES_RE = /^\*\/(\d{1,2}) \* \* \* \*$/;
const HOURS_RE = /^0 \*\/(\d{1,2}) \* \* \*$/;

export function intervalCron(mode: "minutes" | "hours", every: number): string {
  return mode === "minutes" ? `*/${every} * * * *` : `0 */${every} * * *`;
}

/** Which form mode an existing schedule belongs to, and its interval if any. */
export function modeOf(
  draft: Pick<ScheduleDraft, "frequency" | "cron">,
): { mode: ScheduleMode; every: number } {
  if (draft.frequency === "daily") return { mode: "daily", every: 5 };
  if (draft.frequency === "weekly") return { mode: "weekly", every: 5 };
  const cron = draft.cron.trim().replace(/\s+/g, " ");
  const minutes = MINUTES_RE.exec(cron);
  if (minutes && MINUTE_STEPS.includes(Number(minutes[1]))) {
    return { mode: "minutes", every: Number(minutes[1]) };
  }
  const hours = HOURS_RE.exec(cron);
  if (hours && HOUR_STEPS.includes(Number(hours[1]))) {
    return { mode: "hours", every: Number(hours[1]) };
  }
  return { mode: "custom", every: 5 };
}

/** The draft to save for a mode (interval modes become a cron schedule). */
export function applyMode(
  draft: ScheduleDraft,
  mode: ScheduleMode,
  every: number,
): ScheduleDraft {
  switch (mode) {
    case "daily":
      return { ...draft, frequency: "daily" };
    case "weekly":
      return { ...draft, frequency: "weekly" };
    case "minutes":
    case "hours":
      return { ...draft, frequency: "cron", cron: intervalCron(mode, every) };
    case "custom":
      return { ...draft, frequency: "cron" };
  }
}

/** Plain-language reading of a cron expression, or null if it doesn't parse. */
export function describeCron(cron: string): string | null {
  try {
    return cronstrue.toString(cron.trim(), { use24HourTimeFormat: true });
  } catch {
    return null;
  }
}

export function describeSchedule(
  schedule: Pick<Schedule, "frequency" | "timeOfDay" | "daysOfWeek" | "cron">,
): string {
  if (schedule.frequency === "cron") {
    return describeCron(schedule.cron) ?? schedule.cron;
  }
  if (schedule.frequency === "daily") {
    return `Every day at ${schedule.timeOfDay}`;
  }
  const days = [...schedule.daysOfWeek]
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d])
    .join(", ");
  return `Every ${days} at ${schedule.timeOfDay}`;
}

export function toggleDay(days: number[], day: number): number[] {
  return days.includes(day)
    ? days.filter((d) => d !== day)
    : [...days, day].sort((a, b) => a - b);
}

export function isDraftValid(
  draft: ScheduleDraft,
  inputRequired = false,
): boolean {
  if (inputRequired && !draft.input.trim()) return false;
  if (draft.frequency === "cron") {
    return draft.cron.trim().split(/\s+/).length === 5;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.timeOfDay)) return false;
  return draft.frequency === "daily" || draft.daysOfWeek.length > 0;
}

/** Missed runs the user has not looked at yet. */
export function pendingMissed(runs: ScheduleRun[]): ScheduleRun[] {
  return runs.filter((run) => run.status === "missed" && !run.acknowledged);
}

export function totalMissed(runs: ScheduleRun[]): number {
  return pendingMissed(runs).reduce((sum, run) => sum + run.missedCount, 0);
}

export const RUN_STATUS_LABEL: Record<ScheduleRun["status"], string> = {
  running: "Running",
  ok: "Completed",
  failed: "Failed",
  missed: "Missed",
  skipped: "Skipped",
};

export type WizardStep = "when" | "input" | "settings" | "accept";

export const STEP_TITLE: Record<WizardStep, string> = {
  when: "When should it run?",
  input: "What should it receive?",
  settings: "Keep HiveAI running",
  accept: "Before you schedule it",
};

/**
 * The steps a person walks through. Input only when the execution needs one;
 * settings only when there is something left to turn on; and the automatic
 * approval warning is accepted once, when creating (not on every edit).
 */
export function wizardSteps(options: {
  creating: boolean;
  inputRequired: boolean;
  needsSettings: boolean;
}): WizardStep[] {
  return [
    "when",
    ...(options.inputRequired ? (["input"] as const) : []),
    ...(options.creating && options.needsSettings ? (["settings"] as const) : []),
    ...(options.creating ? (["accept"] as const) : []),
  ];
}

/** Whether the person can leave this step. */
export function canAdvance(
  step: WizardStep,
  draft: ScheduleDraft,
  inputRequired: boolean,
  whenProblem: string | null,
): boolean {
  if (step === "when") return !whenProblem && isDraftValid(draft, false);
  if (step === "input") return !inputRequired || draft.input.trim() !== "";
  return true;
}
