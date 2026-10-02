import { assert } from "@std/assert";
import type { BeeContext } from "../../core/microkernel/bee-plugin.ts";
import CounterPlugin from "./index.ts";

function makeContext(dataDir: string): BeeContext {
  return {
    getDataDir: () => dataDir,
    getModel: () => "test-model",
    requestApproval: () => Promise.resolve(true),
    reportStep: () => {},
  };
}

async function withPlugin(
  fn: (plugin: CounterPlugin) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const plugin = new CounterPlugin();
    await plugin.initialize(makeContext(tempDir));
    await fn(plugin);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("counter plugin satisfies its own execution test suite", async () => {
  await withPlugin(async (plugin) => {
    for (const testCase of plugin.executionTests) {
      const output = await plugin.process(testCase.params);
      assert(
        testCase.expect(output),
        `Execution test "${testCase.description}" failed. Got: ${output}`,
      );
    }
  });
});

Deno.test("counter plugin persists increments across calls", async () => {
  await withPlugin(async (plugin) => {
    await plugin.process({ name: "coffees", action: "reset", amount: 1 });
    await plugin.process({ name: "coffees", action: "increment", amount: 3 });
    const output = await plugin.process({
      name: "coffees",
      action: "get",
      amount: 1,
    });

    assert(output.includes("currently has a value of 3"));
  });
});

Deno.test("counter plugin declares at least 3 selection tests per kind", () => {
  const plugin = new CounterPlugin();
  const kinds = ["positive", "negative", "ambiguous"] as const;

  for (const kind of kinds) {
    const count = plugin.selectionTests.filter((t) => t.kind === kind).length;
    assert(count >= 3, `Expected at least 3 "${kind}" selection tests`);
  }
});
