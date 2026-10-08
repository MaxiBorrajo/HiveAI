import { assert, assertFalse, assertEquals } from "@std/assert";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../../../plugins/counter/index.ts";
import { executeExecutionTest } from "../../../../modules/plugins/use-cases/test-plugin/test-plugin.ts";

async function makeHiveWithCounter() {
  const tempDir = await Deno.makeTempDir();
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: tempDir });
  const plugin = new CounterPlugin();
  await hive.register(plugin);
  await hive.activate(plugin.name);
  return { hive, plugin, tempDir };
}

Deno.test("executeExecutionTest reports success when the plugin output matches expect()", async () => {
  const { hive, plugin, tempDir } = await makeHiveWithCounter();
  try {
    const testCase = plugin.executionTests.find(
      (t) => t.description === "Increment counter by 1",
    )!;

    const res = await executeExecutionTest(hive, plugin, testCase);
    const body = await res.json();

    assert(body.success);
    assert(body.data.details.output.includes("was incremented by 1"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("executeExecutionTest reports failure with 'Logic Error' when output does not match expect()", async () => {
  const { hive, plugin, tempDir } = await makeHiveWithCounter();
  try {
    const testCase = {
      description: "Deliberately wrong expectation",
      kind: "happy" as const,
      params: { name: "coffees", action: "increment" as const, amount: 1 },
      expect: (output: string) => output.includes("this text never appears"),
    };

    const res = await executeExecutionTest(hive, plugin, testCase);
    const body = await res.json();

    assertFalse(body.success);
    assertEquals(body.data.failureCategory, "Logic Error");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("executeExecutionTest reports failure with 'Logic Error' (not a raw exception) when the plugin itself throws, because hive.execute() already catches it", async () => {
  const { hive, plugin, tempDir } = await makeHiveWithCounter();
  try {
    const originalProcess = plugin.process.bind(plugin);
    plugin.process = () => {
      throw new Error("boom");
    };

    const testCase = {
      description: "Plugin throws internally",
      kind: "error" as const,
      params: { name: "coffees", action: "increment" as const, amount: 1 },
      expect: (output: string) => output.includes("this text never appears"),
    };
    const res = await executeExecutionTest(hive, plugin, testCase);
    plugin.process = originalProcess;
    const body = await res.json();

    assertFalse(body.success);
    // hive.execute() wraps plugin exceptions into an error message rather
    // than rethrowing, so this surfaces as a failed expectation ("Logic
    // Error"), not as an "Exception" from executeExecutionTest's own catch.
    assertEquals(body.data.failureCategory, "Logic Error");
    assert(body.data.details.output.includes("boom"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("executeExecutionTest reports failure with 'Exception' when hive.execute() itself throws", async () => {
  const { hive, plugin, tempDir } = await makeHiveWithCounter();
  try {
    const originalExecute = hive.execute.bind(hive);
    hive.execute = () => {
      throw new Error("hive-level failure");
    };

    const testCase = plugin.executionTests[0];
    const res = await executeExecutionTest(hive, plugin, testCase);
    hive.execute = originalExecute;
    const body = await res.json();

    assertFalse(body.success);
    assertEquals(body.data.failureCategory, "Exception");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("executeExecutionTest measures a non-negative duration", async () => {
  const { hive, plugin, tempDir } = await makeHiveWithCounter();
  try {
    const testCase = plugin.executionTests[0];
    const res = await executeExecutionTest(hive, plugin, testCase);
    const body = await res.json();

    assert(body.data.metrics.durationMs >= 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
