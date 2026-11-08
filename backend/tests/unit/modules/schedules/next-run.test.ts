import { assertEquals, assertThrows } from "@std/assert";
import {
  computeNextRun,
  slotsBetween,
  validateTiming,
} from "../../../../modules/schedules/lib/next-run.ts";

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

const daily10 = { frequency: "daily", timeOfDay: "10:00", daysOfWeek: [] } as const;

Deno.test("daily: before the time it runs today", () => {
  assertEquals(computeNextRun(daily10, at(2026, 11, 7, 9, 0)), at(2026, 11, 7, 10, 0));
});

Deno.test("daily: at or after the time it runs tomorrow", () => {
  assertEquals(computeNextRun(daily10, at(2026, 11, 7, 10, 0)), at(2026, 11, 8, 10, 0));
  assertEquals(computeNextRun(daily10, at(2026, 11, 7, 23, 59)), at(2026, 11, 8, 10, 0));
});

Deno.test("daily: crosses month and year boundaries", () => {
  assertEquals(computeNextRun(daily10, at(2026, 12, 31, 11)), at(2027, 1, 1, 10));
});

Deno.test("weekly: picks the next allowed weekday", () => {
  // 2026-11-07 is a Saturday; Monday(1) and Wednesday(3).
  const timing = { frequency: "weekly", timeOfDay: "08:30", daysOfWeek: [1, 3] } as const;
  assertEquals(computeNextRun(timing, at(2026, 11, 7, 12)), at(2026, 11, 9, 8, 30));
  assertEquals(computeNextRun(timing, at(2026, 11, 9, 9)), at(2026, 11, 11, 8, 30));
});

Deno.test("weekly: a single day wraps to next week", () => {
  const timing = { frequency: "weekly", timeOfDay: "08:30", daysOfWeek: [6] } as const;
  assertEquals(computeNextRun(timing, at(2026, 11, 7, 9)), at(2026, 11, 14, 8, 30));
});

Deno.test("slotsBetween counts the slots in the window and returns the last", () => {
  const { count, last } = slotsBetween(daily10, at(2026, 11, 7, 9), at(2026, 11, 9, 11));
  assertEquals(count, 3);
  assertEquals(last, at(2026, 11, 9, 10));
  assertEquals(slotsBetween(daily10, at(2026, 11, 7, 11), at(2026, 11, 8, 9)).count, 0);
});

Deno.test("validateTiming rejects bad input", () => {
  assertEquals(validateTiming(daily10 as never), null);
  assertEquals(validateTiming({ ...daily10, timeOfDay: "25:00" } as never) !== null, true);
  assertEquals(validateTiming({ ...daily10, timeOfDay: "9:00" } as never) !== null, true);
  assertEquals(validateTiming({ frequency: "weekly", timeOfDay: "10:00", daysOfWeek: [] }) !== null, true);
  assertEquals(validateTiming({ frequency: "weekly", timeOfDay: "10:00", daysOfWeek: [7] }) !== null, true);
  assertEquals(validateTiming({ frequency: "hourly" as never, timeOfDay: "10:00", daysOfWeek: [] }) !== null, true);
});

Deno.test("computeNextRun throws on an invalid time", () => {
  assertThrows(() => computeNextRun({ ...daily10, timeOfDay: "nope" } as never, 0));
});
