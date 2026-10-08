import { assertEquals } from "@std/assert";
import type { ToolCall } from "@langchain/core/messages/tool";
import { HiveMicrokernel } from "../../../../../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../../../../../plugins/counter/index.ts";
import { runToolCall, summarize } from "../../../../../../core/ai/strategy/shared/run-tool-call.ts";

// runToolCall reads from the HiveMicrokernel singleton (getInstance), so
// each test registers its own uniquely-named plugin instance and tears it
// down in `finally` to avoid leaking state across tests.
async function withRegisteredCounter(
  pluginName: string,
  fn: (hive: HiveMicrokernel) => Promise<void>,
) {
  const hive = HiveMicrokernel.getInstance();
  const tempDir = await Deno.makeTempDir();
  hive.configure({ dataDir: tempDir });

  const plugin = new CounterPlugin();
  plugin.name = pluginName;
  await hive.register(plugin);
  await hive.activate(pluginName);

  try {
    await fn(hive);
  } finally {
    await hive.unregister(pluginName);
  }
}

function toolCall(overrides: Partial<ToolCall>): ToolCall {
  return { name: "unused", args: {}, id: "call_1", type: "tool_call", ...overrides };
}

// --- summarize ---

Deno.test("summarize - short text passes through unchanged", () => {
  assertEquals(summarize("short text"), "short text");
});

Deno.test("summarize - collapses internal whitespace/newlines into single spaces", () => {
  assertEquals(summarize("line one\nline   two"), "line one line two");
});

Deno.test("summarize - truncates with ellipsis beyond maxChars", () => {
  const long = "a".repeat(300);
  const result = summarize(long);
  assertEquals(result.length, 203); // 200 chars + "..."
  assertEquals(result.endsWith("..."), true);
});

Deno.test("summarize - respects a custom maxChars", () => {
  const result = summarize("abcdefghij", 5);
  assertEquals(result, "abcde...");
});

// --- runToolCall ---

Deno.test("runToolCall - returns an error ToolMessage when the tool is not registered anywhere", async () => {
  const { message, steps, ok } = await runToolCall(
    toolCall({ name: "does-not-exist" }),
    "chat-1",
    undefined,
    "TestStrategy",
  );
  assertEquals(ok, false);
  assertEquals(String(message.content).includes("no tool named 'does-not-exist'"), true);
  assertEquals(steps[0].summary, "That tool does not exist in the hive");
});

Deno.test("runToolCall - successfully invokes a registered microkernel plugin and records executor + plugin steps", async () => {
  await withRegisteredCounter("run-tool-call-counter-1", async () => {
    const { message, steps, ok } = await runToolCall(
      toolCall({
        name: "run-tool-call-counter-1",
        args: { name: "test-counter", action: "increment" },
      }),
      "chat-1",
      undefined,
      "TestStrategy",
    );

    assertEquals(ok, true);
    assertEquals(String(message.content).includes("test-counter"), true);
    assertEquals(steps.some((s) => s.node === "Executor"), true);
  });
});

Deno.test("runToolCall - a schema-rejecting tool call is caught and returned as an error ToolMessage, not thrown", async () => {
  await withRegisteredCounter("run-tool-call-counter-2", async () => {
    // "not-a-real-action" fails the plugin's own Zod enum validation inside
    // tool.invoke(), which throws — runToolCall must catch it, not propagate it.
    const { message, ok, steps } = await runToolCall(
      toolCall({
        name: "run-tool-call-counter-2",
        args: { name: "x", action: "not-a-real-action" },
      }),
      "chat-1",
      undefined,
      "TestStrategy",
    );

    assertEquals(ok, false);
    assertEquals(String(message.content).includes("failed"), true);
    assertEquals(steps[0].summary.includes("Error"), true);
  });
});
