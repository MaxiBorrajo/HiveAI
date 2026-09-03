import { z } from "zod";
import { join } from "node:path";
import type {
  BeePlugin,
  BeeContext,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const schema = z.object({
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

type CounterSchema = typeof schema;

export default class CounterPlugin implements BeePlugin<CounterSchema> {
  name = "counter";
  description =
    "Keeps track of named counters that persist across sessions. Allows incrementing a counter, checking its value, or resetting it to zero.";

  schema = schema;

  selectionTests: SelectionTestCase[] = [
    // 3 Positive
    {
      query: "add a coffee to the count",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "how many pomodoros do I have so far?",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "reset the counter for glasses of water to zero",
      kind: "positive",
      shouldInvoke: true,
    },
    // 3 Negative
    {
      query: "what time is it in Tokyo?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "search for the report.pdf file in my documents",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "write an essay about artificial intelligence",
      kind: "negative",
      shouldInvoke: false,
    },
    // 3 Ambiguous
    {
      query: "how many words are in this document?",
      kind: "ambiguous",
    },
    {
      query: "calculate 45 plus 82 minus 10",
      kind: "ambiguous",
    },
    {
      query: "track the time spent on the call",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<CounterSchema>[] = [
    // 3 Happy
    {
      description: "Increment counter by 1",
      kind: "happy",
      params: { name: "coffees", action: "increment", amount: 1 },
      expect: (output: string) => output.includes("was incremented by 1"),
    },
    {
      description: "Get current counter value",
      kind: "happy",
      params: { name: "coffees", action: "get", amount: 1 },
      expect: (output: string) =>
        output.includes("Counter 'coffees' currently has a value of") ||
        output.includes("Counter 'coffees' has no records yet."),
    },
    {
      description: "Reset counter to zero",
      kind: "happy",
      params: { name: "coffees", action: "reset", amount: 1 },
      expect: (output: string) => output.includes("was reset to 0"),
    },
    // 3 Edge
    {
      description: "Get value of a non-existent counter",
      kind: "edge",
      params: { name: "non_existent_counter_xyz", action: "get", amount: 1 },
      expect: (output: string) => output.includes("has no records yet"),
    },
    {
      description: "Increment counter by zero",
      kind: "edge",
      params: { name: "coffees", action: "increment", amount: 0 },
      expect: (output: string) => output.includes("was incremented by 0"),
    },
    {
      description: "Increment counter with negative amount (decrement)",
      kind: "edge",
      params: { name: "coffees", action: "increment", amount: -2 },
      expect: (output: string) => output.includes("was incremented by -2"),
    },
    // 3 Error
    {
      description: "Invalid action provided",
      kind: "error",
      params: { name: "coffees", action: "multiply" as any, amount: 1 },
      expect: (output: string) => output.toLowerCase().includes("error"),
    },
    {
      description: "Non-integer increment amount",
      kind: "error",
      params: { name: "coffees", action: "increment", amount: 2.5 as any },
      expect: (output: string) => output.toLowerCase().includes("error"),
    },
    {
      description: "Missing required counter name",
      kind: "error",
      params: { name: undefined as any, action: "increment", amount: 1 },
      expect: (output: string) => output.toLowerCase().includes("error"),
    },
  ];

  // Backward compatibility alias for microkernel / UI
  get testCases() {
    return this.selectionTests;
  }

  private dataPath: string = "";

  initialize(context: BeeContext): void {
    const dataDir = context.getDataDir();
    this.dataPath = join(dataDir, "counters.json");
  }

  async process(input: z.infer<CounterSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `Error in the provided parameters: ${parsed.error.message}`;
    }

    const { name, action, amount } = parsed.data;

    let counters: Record<string, number> = {};
    let notice = "";

    const targetPath = this.dataPath || join(Deno.cwd(), "counters.json");

    try {
      const fileContent = await Deno.readTextFile(targetPath);
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
        await Deno.writeTextFile(targetPath, JSON.stringify(counters, null, 2));
      } catch (error) {
        return `${resultText} However, there was an error saving to disk: ${
          (error as Error).message
        }`;
      }
    }

    return resultText + notice;
  }
}
