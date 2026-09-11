import { type AIMessage, HumanMessage } from "@langchain/core/messages";
import type { z } from "zod";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type {
  BeePlugin,
  ExecutionTestCase,
  SelectionTestCase,
} from "../../../../core/microkernel/bee-plugin.ts";
import type { ExecutionTestResult, SelectionTestResult, TestKind } from "./types.ts";
import { HiveMind } from "../../../../core/ai/strategy/SADER/graph.ts";
import { Scout } from "../../../../core/ai/strategy/SCOUT/graph.ts";
import { homeDir } from "hive-ai";
import { join } from "node:path";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export async function handleTest(
  hive: HiveMicrokernel,
  model: string,
  selectorModel: string,
  strategy: string,
  pluginName: string,
  index: number,
  type: TestKind = "selection",
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  hive.configure({
    dataDir: join(homeDir!, ".hiveai", "tests"),
  });

  const wasActive = hive.isActive(pluginName);

  if (!wasActive) await hive.activate(pluginName);

  const plugin = hive.getPlugin(pluginName);

  if (!plugin) {
    return ResponseBuilder.error(["Plugin not found"], undefined, {
      status: 404,
      headers,
    });
  }

  const tests =
    type === "selection" ? plugin.selectionTests : plugin.executionTests;

  console.log(tests);
  console.log(tests[index]);

  if (!plugin || !tests || !tests[index]) {
    return ResponseBuilder.error(["Test not found"], undefined, {
      status: 404,
      headers,
    });
  }

  const testCase = tests[index];

  if (type === "selection") {
    return await executeSelectionTest(
      testCase as SelectionTestCase,
      model,
      selectorModel,
      pluginName,
      req.signal,
      strategy,
    );
  } else {
    return await executeExecutionTest(
      hive,
      plugin,
      testCase as ExecutionTestCase<typeof plugin.schema>,
    );
  }
}

// SCOUT can request more than one tool per turn, and can loop through
// several turns before answering — so "was this plugin selected" has to
// scan every tool call across the whole run, not just the first one of the
// first AI message. Falls back to the very first tool call seen anywhere
// (if the plugin under test was never chosen) so callers can still report
// what was picked instead.
function extractScoutToolCall(
  messages: unknown[],
  pluginName: string,
): { name: string; args: Record<string, unknown> } | undefined {
  let firstCall: { name: string; args: Record<string, unknown> } | undefined;

  for (const msg of messages) {
    const aiMsg = msg as AIMessage;
    if (aiMsg.type !== "ai" || !aiMsg.tool_calls?.length) continue;

    for (const call of aiMsg.tool_calls) {
      const parsed = { name: call.name, args: call.args as Record<string, unknown> };
      firstCall ??= parsed;
      if (call.name === pluginName) return parsed;
    }
  }

  return firstCall;
}

export async function executeSelectionTest(
  testCase: SelectionTestCase,
  model: string,
  selectorModel: string,
  pluginName: string,
  signal: AbortSignal,
  strategy: string,
) {
  const start = performance.now();
  let success = false;
  const errors: string[] = [];
  let failureCategory: string | undefined;
  let details: {
    selectedTool?: string;
    extractedParams?: Record<string, unknown>;
  } = {};
  let inputTokens = 0;
  let outputTokens = 0;

  // A selection test only wants to know whether the model would pick THIS
  // plugin for this query. Both strategies bind every active plugin to the
  // model and can run more than one real tool call before finishing (SCOUT
  // natively, SADER via its chaining), so leaving other plugins active here
  // risks a "negative" test (shouldInvoke: false) triggering a real,
  // unrelated tool along the way — e.g. run_shell — as a side effect of just
  // running a selection test. Deactivate every other plugin for the
  // duration of the call so only the one under test can be invoked at all.
  const microkernel = HiveMicrokernel.getInstance();
  const otherActivePlugins = microkernel
    .getRegisteredPlugins()
    .filter((p) => p.name !== pluginName && microkernel.isActive(p.name))
    .map((p) => p.name);

  for (const name of otherActivePlugins) {
    await microkernel.deactivate(name);
  }

  try {
    try {
      let selectedTool: string | undefined;
      let params: Record<string, unknown> | undefined;
      let resultMessages: unknown[] = [];

      if (strategy === "SCOUT") {
        const result = await Scout.invoke(
          {
            messages: [new HumanMessage(testCase.query)],
            chatId: "plugin-selection-test",
            model,
            modelOptions: {},
          },
          { signal },
        );
        resultMessages = result.messages ?? [];
        const call = extractScoutToolCall(resultMessages, pluginName);
        selectedTool = call?.name;
        params = call?.args;
      } else {
        const result = await HiveMind.invoke(
          {
            messages: [new HumanMessage(testCase.query)],
            currentPrompt: testCase.query,
            model,
            selectorModel,
          },
          { signal },
        );
        resultMessages = result.messages ?? [];
        selectedTool = result.selectedTool;
        params = result.args?.params;
      }

      details = {
        selectedTool,
        extractedParams: params,
      };

      if (Array.isArray(resultMessages)) {
        for (const msg of resultMessages) {
          const aiMsg = msg as AIMessage;
          if (aiMsg.type === "ai" && aiMsg.response_metadata) {
            inputTokens += aiMsg.usage_metadata?.input_tokens ?? 0;
            outputTokens += aiMsg.usage_metadata?.output_tokens ?? 0;
          }
        }
      }

      const didInvoke = selectedTool === pluginName;

      if (testCase.shouldInvoke && !didInvoke) {
        failureCategory = "Misrouting";
        errors.push(
          `Expected plugin '${pluginName}' to be selected, but '${selectedTool || "none"}' was selected instead.`,
        );
      } else if (!testCase.shouldInvoke && didInvoke) {
        failureCategory = "Misrouting";
        errors.push(
          `Expected plugin '${pluginName}' NOT to be selected, but it was.`,
        );
      } else {
        if (testCase.shouldInvoke && didInvoke && testCase.expectedParams) {
          const actualParams = params || {};
          for (const [key, expectedValue] of Object.entries(
            testCase.expectedParams,
          )) {
            const actualValue = actualParams[key];
            if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
              failureCategory = "Hallucination";
              errors.push(
                `Parameter '${key}' mismatch. Expected: ${JSON.stringify(expectedValue)}, but got: ${JSON.stringify(actualValue)}`,
              );
            }
          }
        }
        if (errors.length === 0) {
          success = true;
        }
      }
    } catch (err) {
      failureCategory = "Error";
      errors.push(String(err));
    }
  } finally {
    for (const name of otherActivePlugins) {
      await microkernel.activate(name);
    }
  }
  const end = performance.now();
  const durationMs = Math.round(end - start);
  const data: SelectionTestResult = {
    failureCategory,
    details,
    metrics: {
      durationMs,
      inputTokens,
      outputTokens,
      tokensPerSecond:
        durationMs > 0 && outputTokens > 0
          ? Number(((outputTokens / durationMs) * 1000).toFixed(1))
          : 0,
    },
  };

  if (success) {
    return ResponseBuilder.success(data);
  } else {
    return ResponseBuilder.error(errors, data);
  }
}

export async function executeExecutionTest<S extends z.ZodType = z.ZodType>(
  hive: HiveMicrokernel,
  plugin: BeePlugin<S>,
  testCase: ExecutionTestCase<S>,
) {
  const start = performance.now();
  let success = false;
  const errors: string[] = [];
  let failureCategory: string | undefined;
  let details: { output?: string } = {};

  try {
    const result = await hive.execute(plugin.name, testCase.params);
    details = { output: result.message };
    success = testCase.expect(result.message);
    if (!success) {
      failureCategory = "Logic Error";
      errors.push(
        `Output did not meet expectations. Output returned: ${result.message}`,
      );
    }
  } catch (err) {
    failureCategory = "Exception";
    errors.push(String(err));
  }

  const end = performance.now();
  const data: ExecutionTestResult = {
    failureCategory,
    details,
    metrics: {
      durationMs: Math.round(end - start),
    },
  };

  if (success) {
    return ResponseBuilder.success(data);
  } else {
    return ResponseBuilder.error(errors, data);
  }
}
