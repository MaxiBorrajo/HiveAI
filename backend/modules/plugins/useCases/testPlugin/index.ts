import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { z, ZodObject } from "zod";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type {
  BeePlugin,
  ExecutionTestCase,
  SelectionTestCase,
} from "../../../../core/microkernel/bee-plugin.ts";
import type { TestKind } from "./types.ts";
import { HiveMind } from "../../../../core/ai/strategy/SADER/graph.ts";
import { homeDir } from "hive-ai";
import { join } from "node:path";

export async function handleTest(
  hive: HiveMicrokernel,
  model: string,
  selectorModel: string,
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

  if (!wasActive) hive.activate(pluginName);

  const plugin = hive.getPlugin(pluginName);

  if (!plugin) {
    return Response.json(
      { error: "Plugin not found" },
      { status: 404, headers },
    );
  }

  const tests =
    type === "selection" ? plugin.selectionTests : plugin.executionTests;

  console.log(tests);
  console.log(tests[index]);

  if (!plugin || !tests || !tests[index]) {
    return Response.json({ error: "Test not found" }, { status: 404, headers });
  }

  const testCase = tests[index];

  if (type === "selection") {
    return await executeSelectionTest(
      testCase as SelectionTestCase,
      model,
      selectorModel,
      pluginName,
      req.signal,
    );
  } else {
    return await executeExecutionTest(
      hive,
      plugin,
      testCase as ExecutionTestCase<typeof plugin.schema>,
    );
  }
}

export async function executeSelectionTest(
  testCase: SelectionTestCase,
  model: string,
  selectorModel: string,
  pluginName: string,
  signal: AbortSignal,
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

  try {
    const result = await HiveMind.invoke(
      {
        messages: [new HumanMessage(testCase.query)],
        currentPrompt: testCase.query,
        model,
        selectorModel,
      },
      { signal },
    );

    details = {
      selectedTool: result.selectedTool,
      extractedParams: result.args?.params,
    };

    if (result.messages && Array.isArray(result.messages)) {
      for (const msg of result.messages) {
        if (msg.type === "ai" && msg.response_metadata) {
          inputTokens += (msg as AIMessage).usage_metadata?.input_tokens ?? 0;
          outputTokens += (msg as AIMessage).usage_metadata?.output_tokens ?? 0;
        }
      }
    }

    const selected = result.selectedTool;
    const didInvoke = selected === pluginName;

    if (testCase.shouldInvoke && !didInvoke) {
      failureCategory = "Misrouting";
      errors.push(
        `Expected plugin '${pluginName}' to be selected, but '${selected || "none"}' was selected instead.`,
      );
    } else if (!testCase.shouldInvoke && didInvoke) {
      failureCategory = "Misrouting";
      errors.push(
        `Expected plugin '${pluginName}' NOT to be selected, but it was.`,
      );
    } else {
      if (testCase.shouldInvoke && didInvoke && testCase.expectedParams) {
        const actualParams = result.args?.params || {};
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
  const end = performance.now();
  const durationMs = Math.round(end - start);
  return Response.json({
    success,
    errors,
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
  });
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
  } catch (err: any) {
    failureCategory = "Exception";
    errors.push(err.message || String(err));
  } finally {
    const end = performance.now();
    return Response.json({
      success,
      errors,
      failureCategory,
      details,
      metrics: {
        durationMs: Math.round(end - start),
      },
    });
  }
}
