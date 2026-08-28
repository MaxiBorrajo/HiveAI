import { z } from "zod";
import type { BeeContext, BeePlugin } from "../../microkernel/bee-plugin.ts";

export default class CurrentDatetimePlugin implements BeePlugin {
  name = "current_datetime";
  description =
    "Devuelve la fecha y hora actual del sistema. Sirve para saber qué día es hoy o qué hora es. No agenda eventos ni calcula fechas futuras.";

  schema = z.object({
    format: z
      .enum(["date", "time", "full"])
      .default("full")
      .describe(
        "Indica qué parte devolver: 'date' para solo la fecha, 'time' para solo la hora, o 'full' para ambas.",
      ),
    timezone: z
      .string()
      .optional()
      .describe(
        "Zona horaria IANA opcional, por ejemplo 'America/Argentina/Buenos_Aires'. Si se omite, usa la del sistema.",
      ),
  }) as any;

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
