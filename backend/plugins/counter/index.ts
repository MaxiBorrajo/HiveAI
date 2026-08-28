import { z } from "zod";
import { join } from "node:path";
import type { BeeContext, BeePlugin } from "../../microkernel/bee-plugin.ts";

export default class CounterPlugin implements BeePlugin {
  name = "counter";
  description =
    "Lleva contadores con nombre que persisten entre sesiones. Permite incrementar un contador, consultar su valor o reiniciarlo a cero.";

  schema = z.object({
    name: z
      .string()
      .describe("Nombre del contador, por ejemplo 'cafés' o 'pomodoros'"),
    action: z
      .enum(["increment", "get", "reset"])
      .default("increment")
      .describe(
        "Qué hacer con el contador: incrementar ('increment'), consultar ('get') o reiniciar ('reset')",
      ),
    amount: z
      .number()
      .int()
      .default(1)
      .describe(
        "Cuánto incrementar. Solo se usa cuando la acción es increment",
      ),
  });

  private dataPath: string = "";

  initialize(context: BeeContext): void {
    const dataDir = context.getDataDir();
    this.dataPath = join(dataDir, "counters.json");
  }

  async process(input: unknown): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `Error in the provided parameters: ${parsed.error.message}`;
    }

    const { name, action, amount } = parsed.data;

    let counters: Record<string, number> = {};
    let notice = "";

    try {
      const fileContent = await Deno.readTextFile(this.dataPath);
      counters = JSON.parse(fileContent);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        counters = {};
        notice =
          " (Note: The save file was corrupted, starting a new empty one).";
      }
    }

    let resultText = "";

    if (action === "get") {
      const current = counters[name];
      if (current === undefined) {
        resultText = `Counter '${name}' has no records yet.`;
      } else {
        resultText = `Counter '${name}' currently has a value of ${current}.`;
      }
    } else if (action === "reset") {
      counters[name] = 0;
      resultText = `Counter '${name}' was reset to 0.`;
    } else if (action === "increment") {
      const current = counters[name] || 0;
      counters[name] = current + amount;
      resultText = `Counter '${name}' was incremented by ${amount}. Its new value is ${counters[name]}.`;
    }

    if (action === "reset" || action === "increment") {
      try {
        await Deno.writeTextFile(
          this.dataPath,
          JSON.stringify(counters, null, 2),
        );
      } catch (error) {
        return `${resultText} However, there was an error saving to disk: ${
          (error as Error).message
        }`;
      }
    }

    return resultText + notice;
  }
}
