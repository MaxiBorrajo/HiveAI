// Standard 5-field cron (minute hour day-of-month month day-of-week), local
// time. Supports `*`, lists (1,15), ranges (1-5), steps (*/5, 10-30/5),
// month/day names (JAN, MON) and 7 as Sunday. Like Vixie cron, when both
// day-of-month and day-of-week are restricted a day matches if EITHER does.
export interface CronSpec {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  daysOfWeek: ReadonlySet<number>;
  /** day-of-month / day-of-week were not `*`, which changes how they combine. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

interface FieldDef {
  name: string;
  min: number;
  max: number;
  names?: readonly string[];
  nameBase?: number;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const FIELDS: FieldDef[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTHS, nameBase: 1 },
  { name: "day of week", min: 0, max: 7, names: DAYS, nameBase: 0 },
];

export class CronError extends Error {}

function parseValue(raw: string, def: FieldDef): number {
  const named = def.names?.indexOf(raw.toUpperCase()) ?? -1;
  if (named >= 0) return named + (def.nameBase ?? 0);
  if (!/^\d+$/.test(raw)) {
    throw new CronError(`Invalid ${def.name} value '${raw}'.`);
  }
  const value = Number(raw);
  if (value < def.min || value > def.max) {
    throw new CronError(
      `${def.name[0].toUpperCase()}${def.name.slice(1)} must be between ${def.min} and ${def.max}.`,
    );
  }
  return value;
}

function parseField(text: string, def: FieldDef): { values: Set<number>; star: boolean } {
  const values = new Set<number>();
  let star = false;
  for (const part of text.split(",")) {
    if (part === "") throw new CronError(`Empty ${def.name} entry.`);
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined) throw new CronError(`Invalid ${def.name} step '${part}'.`);
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) {
        throw new CronError(`Invalid ${def.name} step '${stepText}'.`);
      }
      step = Number(stepText);
    }

    let from: number;
    let to: number;
    if (range === "*") {
      from = def.min;
      to = def.name === "day of week" ? 6 : def.max;
      if (stepText === undefined) star = true;
    } else if (range.includes("-")) {
      const [a, b, more] = range.split("-");
      if (more !== undefined || a === "" || b === "") {
        throw new CronError(`Invalid ${def.name} range '${range}'.`);
      }
      from = parseValue(a, def);
      to = parseValue(b, def);
      if (from > to) throw new CronError(`Invalid ${def.name} range '${range}'.`);
    } else {
      from = parseValue(range, def);
      to = stepText === undefined ? from : def.max;
    }
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return { values, star };
}

export function parseCron(expression: string): CronSpec {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || parts[0] === "") {
    throw new CronError(
      "A cron expression has 5 fields: minute hour day-of-month month day-of-week.",
    );
  }
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  const daysOfWeek = new Set([...dow.values].map((d) => d % 7));
  return {
    minutes: minute.values,
    hours: hour.values,
    daysOfMonth: dom.values,
    months: month.values,
    daysOfWeek,
    domRestricted: !dom.star,
    dowRestricted: !dow.star,
  };
}

function dayMatches(spec: CronSpec, date: Date): boolean {
  const dom = spec.daysOfMonth.has(date.getDate());
  const dow = spec.daysOfWeek.has(date.getDay());
  if (spec.domRestricted && spec.dowRestricted) return dom || dow;
  return dom && dow;
}

const MAX_YEARS = 8; // enough to reach a Feb 29 from any date

/** First matching minute strictly after `from` (epoch ms), local time. */
export function nextCronRun(spec: CronSpec, from: number): number {
  const date = new Date(from);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const limit = from + MAX_YEARS * 366 * 24 * 3600 * 1000;

  while (date.getTime() <= limit) {
    if (!spec.months.has(date.getMonth() + 1)) {
      date.setMonth(date.getMonth() + 1, 1);
      date.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(spec, date)) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hours.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minutes.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0);
      continue;
    }
    return date.getTime();
  }
  throw new CronError("This expression never matches a real date.");
}
