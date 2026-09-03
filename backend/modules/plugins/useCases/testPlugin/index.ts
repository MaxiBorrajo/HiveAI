import { HumanMessage } from "@langchain/core/messages";
import type { ZodObject } from "zod";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { HiveMind } from "../../../../core/ai/hive-queen.ts";
import type {
  ExecutionTestCase,
  SelectionTestCase,
} from "../../../../core/microkernel/bee-plugin.ts";
import type { TestKind } from "./types.ts";

export async function handleTest(
  hive: HiveMicrokernel,
  model: string,
  pluginName: string,
  index: number,
  type: TestKind = "selection",
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const plugin = hive.getPlugin(pluginName);
  const tests =
    type === "selection" ? plugin?.selectionTests : plugin?.executionTests;
  if (!plugin || !tests || !tests[index]) {
    return Response.json({ error: "Test not found" }, { status: 404, headers });
  }

  const testCase = tests[index];

  const wasActive = hive.isActive(pluginName);
  if (!wasActive) hive.activate(pluginName);

  if (type === "selection") {
    return (await executeSelectionTest(testCase as SelectionTestCase, model)) as unknown as Response;
  } else {
    return (await executeExecutionTest(
      testCase as ExecutionTestCase<typeof plugin.schema>,
      model,
    )) as unknown as Response;
  }
}

export async function executeSelectionTest(
  testCase: SelectionTestCase,
  model: string,
) {
  try {
    const result = await HiveMind.invoke({
      messages: [new HumanMessage(testCase.query)],
      model,
    });
  } catch (err: any) {
  } finally {
  }
}

export async function executeExecutionTest<S extends ZodObject<any, any>>(
  testCase: ExecutionTestCase<S>,
  model: string,
) {
  try {
    const result = await HiveMind.invoke({
      messages: [new HumanMessage((testCase as any).query)],
      model,
    });
  } catch (err: any) {
  } finally {
  }
}

