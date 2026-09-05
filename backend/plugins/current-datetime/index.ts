import { z } from "zod";
import type {
  BeePlugin,
  BeeContext,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const schema = z.object({
  format: z
    .enum(["date", "time", "full"])
    .default("full")
    .describe(
      "Indicates which part to return: 'date' for only the date, 'time' for only the time, or 'full' for both.",
    ),
  timezone: z
    .string()
    .optional()
    .describe(
      "Optional IANA timezone, for example 'America/Argentina/Buenos_Aires'. If omitted, uses the system timezone.",
    ),
});

type CurrentDatetimeSchema = typeof schema;

export default class CurrentDatetimePlugin implements BeePlugin<CurrentDatetimeSchema> {
  name = "current_datetime";
  description =
    "Retrieves the system's current date, time, and timezone. USE CASES: Use this to ground yourself in the present moment when the user asks time-sensitive questions (e.g., 'What time is it?', 'What day is it today?', 'How long until X event?'). It is strictly for reading the current clock; do NOT use this for scheduling alarms, modifying the system time, or making web searches.";

  schema = schema;

  selectionTests: SelectionTestCase<CurrentDatetimeSchema>[] = [
    // 3 Positive
    {
      query: "what time is it right now?",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "what day is today?",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "tell me the current date and time in Tokyo",
      kind: "positive",
      shouldInvoke: true,
    },
    // 3 Negative
    {
      query: "add a coffee to the counter",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "list all files in my home folder",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "schedule a meeting with John for tomorrow at 3pm",
      kind: "negative",
      shouldInvoke: false,
    },
    // 3 Ambiguous
    {
      query: "how many days until New Year's Eve?",
      kind: "ambiguous",
    },
    {
      query: "when was the French Revolution?",
      kind: "ambiguous",
    },
    {
      query: "calculate the duration between 9am and 5pm",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<CurrentDatetimeSchema>[] = [
    // 3 Happy
    {
      description: "Get current date only",
      kind: "happy",
      params: { format: "date" },
      expect: (output: string) => output.includes("Today is"),
    },
    {
      description: "Get current time only",
      kind: "happy",
      params: { format: "time" },
      expect: (output: string) => output.includes("The current time is"),
    },
    {
      description: "Get full date and time",
      kind: "happy",
      params: { format: "full" },
      expect: (output: string) =>
        output.includes("Today is") && output.includes("current time is"),
    },
    // 3 Edge
    {
      description: "Get time with UTC timezone",
      kind: "edge",
      params: { format: "time", timezone: "UTC" },
      expect: (output: string) => output.includes("The current time is"),
    },
    {
      description: "Get date with America/Argentina/Buenos_Aires timezone",
      kind: "edge",
      params: {
        format: "date",
        timezone: "America/Argentina/Buenos_Aires",
      },
      expect: (output: string) => output.includes("Today is"),
    },
    {
      description: "Get full datetime with Asia/Tokyo timezone",
      kind: "edge",
      params: { format: "full", timezone: "Asia/Tokyo" },
      expect: (output: string) =>
        output.includes("Today is") && output.includes("current time is"),
    },
    // 3 Error
    {
      description: "Invalid IANA timezone name",
      kind: "error",
      params: { format: "full", timezone: "Invalid/Fake_Timezone" },
      expect: (output: string) =>
        output.includes("invalid or not recognized by the system"),
    },
    {
      description: "Invalid format enum parameter",
      kind: "error",
      params: { format: "year_only" as any },
      expect: (output: string) => output.toLowerCase().includes("invalid"),
    },
    {
      description: "Numeric timezone string",
      kind: "error",
      params: { format: "time", timezone: "12345678" },
      expect: (output: string) =>
        output.includes("invalid or not recognized by the system"),
    },
  ];

  get testCases() {
    return this.selectionTests;
  }

  initialize(_context: BeeContext): void {}

  process(input: z.infer<CurrentDatetimeSchema>): string {
    const parsed = this.schema.safeParse(input);

    if (!parsed.success) {
      return `The provided parameters are invalid to query date and time. Error: ${parsed.error.message}`;
    }

    const { format, timezone } = parsed.data;
    const now = new Date();

    try {
      let resultText = "";

      if (format === "date") {
        const dateFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        resultText = `Today is ${dateFormatter.format(now)}.`;
      } else if (format === "time") {
        const timeFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
        });
        resultText = `The current time is ${timeFormatter.format(now)}.`;
      } else {
        const dateFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const timeFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
        });
        resultText = `Today is ${dateFormatter.format(now)} and the current time is ${timeFormatter.format(now)}.`;
      }

      return resultText;
    } catch (error) {
      if (error instanceof RangeError) {
        return `The provided timezone ('${timezone}') is invalid or not recognized by the system.`;
      }
      return "An unexpected error occurred while formatting the requested date and time.";
    }
  }
}
