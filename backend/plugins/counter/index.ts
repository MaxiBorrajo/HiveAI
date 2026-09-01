import { z } from "zod";
import { join } from "node:path";
import type {
  BeeContext,
  BeePlugin,
  PluginTestCase,
} from "../../microkernel/bee-plugin.ts";

export default class CounterPlugin implements BeePlugin {
  name = "counter";
  description =
    "Keeps track of named counters that persist across sessions. Allows incrementing a counter, checking its value, or resetting it to zero.";

  schema = z.object({
    name: z
      .string()
      .describe("Name of the counter, for example 'coffees' or 'pomodoros'"),
    action: z
      .enum(["increment", "get", "reset"])
      .default("increment")
      .describe(
        "What to do with the counter: increment ('increment'), consult ('get') or reset ('reset')",
      ),
    amount: z
      .number()
      .int()
      .default(1)
      .describe("How much to increment. Only used when action is increment"),
  });

  testCases: PluginTestCase[] = [
    {
      query: "add a coffee to the count",
      shouldInvoke: true,
      expectedParams: { name: "coffee", action: "increment", amount: 1 },
      expectedOutputValues: ["was incremented by 1"],
    },
    {
      query: "how many pomodoros do I have?",
      shouldInvoke: true,
      expectedParams: { name: "pomodoros", action: "get", amount: 1 },
    },
    {
      query: "clear the coffee count",
      shouldInvoke: true,
      expectedParams: { name: "coffees", action: "reset", amount: 1 },
      expectedOutputValues: ["was reset to 0"],
    },
    {
      query: "what time is it in Tokyo?",
      shouldInvoke: false,
    },
  ];

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
