import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  PluginTestCase,
} from "../../microkernel/bee-plugin.ts";

export default class CurrentDatetimePlugin implements BeePlugin {
  name = "current_datetime";
  description =
    "Returns the current system date and time. Useful to know what day it is today or what time it is. It does not schedule events or calculate future dates.";

  schema = z.object({
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
  }) as any;

  testCases: PluginTestCase[] = [
    {
      query: "what time is it right now?",
      shouldInvoke: true,
      expectedParams: { format: "time" },
      expectedOutputValues: ["The current time is"],
    },
    {
      query: "what day is today?",
      shouldInvoke: true,
      expectedParams: { format: "date" },
      expectedOutputValues: ["Today is"],
    },
    {
      query: "add a coffee",
      shouldInvoke: false,
    },
  ];

  initialize(_context: BeeContext): void {}

  process(input: unknown): string {
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
