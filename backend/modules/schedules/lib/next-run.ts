import type { ScheduleFrequency } from "../../../infrastructure/db/schema/schedules.ts";
import { CronError, nextCronRun, parseCron } from "./cron.ts";

export interface ScheduleTiming {
  frequency: ScheduleFrequency;
  /** Local wall-clock "HH:MM" (daily / weekly). */
  timeOfDay: string;
  /** 0 (Sunday) - 6 (Saturday). Weekly only. */
  daysOfWeek: readonly number[];
  /** 5-field cron expression. Cron only. */
  cron?: string;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimeOfDay(
  value: string,
): { hours: number; minutes: number } | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/** Every frequency is a cron expression underneath; daily/weekly are presets. */
export function cronOf(timing: ScheduleTiming): string {
  if (timing.frequency === "cron") return (timing.cron ?? "").trim();
  const time = parseTimeOfDay(timing.timeOfDay);
  if (!time) throw new Error(`Invalid time of day '${timing.timeOfDay}'`);
  const days = timing.frequency === "weekly"
    ? [...timing.daysOfWeek].sort((a, b) => a - b).join(",")
    : "*";
  return `${time.minutes} ${time.hours} * * ${days}`;
}

/** Returns an error message, or null when the timing is valid. */
export function validateTiming(timing: ScheduleTiming): string | null {
  if (!["daily", "weekly", "cron"].includes(timing.frequency)) {
    return "Frequency must be 'daily', 'weekly' or 'cron'.";
  }
  if (timing.frequency === "cron") {
    try {
      const spec = parseCron(timing.cron ?? "");
      nextCronRun(spec, Date.now());
      return null;
    } catch (error) {
      if (error instanceof CronError) return error.message;
      throw error;
    }
  }
  if (!parseTimeOfDay(timing.timeOfDay)) {
    return "Time must be in HH:MM (24h) format.";
  }
  if (timing.frequency === "weekly") {
    const days = timing.daysOfWeek;
    if (
      !Array.isArray(days) || days.length === 0 ||
      days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    ) {
      return "Pick at least one day of the week.";
    }
  }
  return null;
}

/** First scheduled slot strictly after `from` (epoch ms), in local time. */
export function computeNextRun(timing: ScheduleTiming, from: number): number {
  return nextCronRun(parseCron(cronOf(timing)), from);
}

/** The next `count` slots after `from`, for previews. */
export function upcomingRuns(
  timing: ScheduleTiming,
  from: number,
  count: number,
): number[] {
  const spec = parseCron(cronOf(timing));
  const out: number[] = [];
  let cursor = from;
  while (out.length < count) {
    cursor = nextCronRun(spec, cursor);
    out.push(cursor);
  }
  return out;
}

/** Slots in (after, upTo]: how many (capped), and the latest one (0 when none). */
export const MAX_COUNTED_SLOTS = 10_000;

export function slotsBetween(
  timing: ScheduleTiming,
  after: number,
  upTo: number,
): { count: number; last: number } {
  const spec = parseCron(cronOf(timing));
  let count = 0;
  let last = 0;
  let cursor = after;
  while (count < MAX_COUNTED_SLOTS) {
    const next = nextCronRun(spec, cursor);
    if (next > upTo) break;
    count++;
    last = next;
    cursor = next;
  }
  return { count, last };
}
