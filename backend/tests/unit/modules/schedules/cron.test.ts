import { assertEquals, assertThrows } from "@std/assert";
import { CronError, nextCronRun, parseCron } from "../../../../modules/schedules/lib/cron.ts";
import {
  computeNextRun,
  slotsBetween,
  upcomingRuns,
  validateTiming,
} from "../../../../modules/schedules/lib/next-run.ts";

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s).getTime();
const next = (expr: string, from: number) => nextCronRun(parseCron(expr), from);

Deno.test("every 5 minutes lands on the next multiple of 5, strictly after now", () => {
  assertEquals(next("*/5 * * * *", at(2026, 11, 7, 10, 2)), at(2026, 11, 7, 10, 5));
  assertEquals(next("*/5 * * * *", at(2026, 11, 7, 10, 5)), at(2026, 11, 7, 10, 10));
  assertEquals(next("*/5 * * * *", at(2026, 11, 7, 10, 5, 30)), at(2026, 11, 7, 10, 10));
  assertEquals(next("*/5 * * * *", at(2026, 11, 7, 10, 58)), at(2026, 11, 7, 11, 0));
});

Deno.test("every minute and every N hours", () => {
  assertEquals(next("* * * * *", at(2026, 11, 7, 23, 59)), at(2026, 11, 8, 0, 0));
  assertEquals(next("0 */6 * * *", at(2026, 11, 7, 7, 0)), at(2026, 11, 7, 12, 0));
  assertEquals(next("0 */6 * * *", at(2026, 11, 7, 19, 0)), at(2026, 11, 8, 0, 0));
});

Deno.test("lists, ranges and range steps", () => {
  assertEquals(next("0,30 9-17 * * *", at(2026, 11, 7, 9, 30)), at(2026, 11, 7, 10, 0));
  assertEquals(next("0,30 9-17 * * *", at(2026, 11, 7, 17, 30)), at(2026, 11, 8, 9, 0));
  assertEquals(next("10-30/10 * * * *", at(2026, 11, 7, 10, 0)), at(2026, 11, 7, 10, 10));
  assertEquals(next("10-30/10 * * * *", at(2026, 11, 7, 10, 20)), at(2026, 11, 7, 10, 30));
});

Deno.test("weekdays: 2026-11-07 is a Saturday, so Mon-Fri 09:00 is Monday", () => {
  assertEquals(next("0 9 * * 1-5", at(2026, 11, 7, 12)), at(2026, 11, 9, 9, 0));
  assertEquals(next("0 9 * * MON-FRI", at(2026, 11, 7, 12)), at(2026, 11, 9, 9, 0));
});

Deno.test("7 and 0 are both Sunday", () => {
  assertEquals(next("0 9 * * 7", at(2026, 11, 7, 12)), at(2026, 11, 8, 9, 0));
  assertEquals(next("0 9 * * 0", at(2026, 11, 7, 12)), at(2026, 11, 8, 9, 0));
});

Deno.test("day-of-month and month, including month names", () => {
  assertEquals(next("0 0 1 * *", at(2026, 11, 7)), at(2026, 12, 1));
  assertEquals(next("0 8 15 JAN *", at(2026, 11, 7)), at(2027, 1, 15, 8));
  assertEquals(next("30 4 31 * *", at(2026, 11, 7)), at(2026, 12, 31, 4, 30), "skips 30-day November");
});

Deno.test("dom and dow both restricted: either matches (Vixie cron)", () => {
  // the 13th OR any Friday
  assertEquals(next("0 0 13 * 5", at(2026, 11, 7)), at(2026, 11, 13));
  assertEquals(next("0 0 13 * 5", at(2026, 11, 13, 1)), at(2026, 11, 20));
});

Deno.test("Feb 29 is reached across years", () => {
  assertEquals(next("0 0 29 2 *", at(2026, 3, 1)), at(2028, 2, 29));
});

Deno.test("invalid expressions say what is wrong", () => {
  for (const bad of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "*/0 * * * *", "5-1 * * * *", "a * * * *", "1,,2 * * * *", "*/x * * * *"]) {
    assertThrows(() => parseCron(bad), CronError, undefined, `should reject '${bad}'`);
  }
});

Deno.test("an impossible date is reported instead of looping forever", () => {
  assertThrows(() => next("0 0 31 2 *", at(2026, 1, 1)), CronError, "never matches");
  assertEquals(validateTiming({ frequency: "cron", timeOfDay: "00:00", daysOfWeek: [], cron: "0 0 31 2 *" })?.includes("never"), true);
});

Deno.test("validateTiming checks cron schedules", () => {
  const base = { frequency: "cron", timeOfDay: "00:00", daysOfWeek: [] } as const;
  assertEquals(validateTiming({ ...base, cron: "*/5 * * * *" }), null);
  assertEquals(validateTiming({ ...base, cron: "nope" }) !== null, true);
  assertEquals(validateTiming({ ...base }) !== null, true, "cron frequency needs an expression");
});

Deno.test("daily and weekly presets behave the same through the cron engine", () => {
  assertEquals(
    computeNextRun({ frequency: "daily", timeOfDay: "10:00", daysOfWeek: [] }, at(2026, 11, 7, 9)),
    at(2026, 11, 7, 10),
  );
  assertEquals(
    computeNextRun({ frequency: "weekly", timeOfDay: "08:30", daysOfWeek: [3, 1] }, at(2026, 11, 7, 12)),
    at(2026, 11, 9, 8, 30),
  );
});

Deno.test("upcomingRuns returns consecutive slots", () => {
  const timing = { frequency: "cron", timeOfDay: "00:00", daysOfWeek: [], cron: "*/15 * * * *" } as const;
  assertEquals(upcomingRuns(timing, at(2026, 11, 7, 10, 1), 3), [
    at(2026, 11, 7, 10, 15),
    at(2026, 11, 7, 10, 30),
    at(2026, 11, 7, 10, 45),
  ]);
});

Deno.test("slotsBetween counts missed 5-minute slots", () => {
  const timing = { frequency: "cron", timeOfDay: "00:00", daysOfWeek: [], cron: "*/5 * * * *" } as const;
  const { count, last } = slotsBetween(timing, at(2026, 11, 7, 10, 0), at(2026, 11, 7, 11, 0, 30));
  assertEquals(count, 12);
  assertEquals(last, at(2026, 11, 7, 11, 0));
});
