import ollama from "ollama";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../plugins/counter/index.ts";
import { buildStateSchema, compileGraph } from "../../core/ai/visual-builder/execution/compiler.ts";
import { createPluginNodeRegistry } from "../../modules/executions/use-cases/run-execution/plugin-node-executor.ts";
import type { ToolProvider } from "../../core/ai/visual-builder/types.ts";
import type { ModelRef } from "../../core/ai/providers/types.ts";
import { buildExecutionCases } from "./executionCases.ts";
import { modelRefLabel } from "./model-ref.ts";
import { captureUsage } from "./usage-capture.ts";
import type { EvalVerdict } from "./metrics.ts";

const EXECUTION_TIMEOUT_MS = 120_000;

async function ensureOllamaModelAvailable(model: string): Promise<boolean> {
  try {
    const { models } = await ollama.list();
    return models.some((m) => m.name === model || m.model === model);
  } catch {
    return false;
  }
}

export async function runExecutionSuite(
  runId: string,
  executorRef: ModelRef = { provider: "ollama", model: "qwen3:8b" },
): Promise<EvalVerdict[]> {
  if (executorRef.provider === "ollama") {
    const available = await ensureOllamaModelAvailable(executorRef.model);
    if (!available) {
      console.log(
        `SKIPPED (execution): Ollama model '${executorRef.model}' is not available. Run 'ollama pull ${executorRef.model}'.`,
      );
      return [];
    }
  }

  const tempDir = await Deno.makeTempDir();
  const hive = HiveMicrokernel.getInstance();
  hive.configure({ dataDir: tempDir, model: executorRef.model });
  await hive.register(new CounterPlugin());
  await hive.activate("counter");

  const pluginRegistry = createPluginNodeRegistry(hive);
  const toolProvider: ToolProvider = {
    getTool: (name: string) => hive.getTool(name),
  };

  const label = modelRefLabel(executorRef);
  const cases = buildExecutionCases(executorRef.model, executorRef.provider, executorRef.keyId);

  const verdicts: EvalVerdict[] = [];
  for (const testCase of cases) {
    console.log(`Running: ${testCase.name}`);
    try {
      const graph = testCase.buildGraph();
      const app = compileGraph(graph, buildStateSchema(graph.stateSchema), pluginRegistry, toolProvider);

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`execution exceeded ${EXECUTION_TIMEOUT_MS}ms`)), EXECUTION_TIMEOUT_MS),
      );

      const { result: finalState, usage } = await captureUsage(() =>
        Promise.race([app.invoke(testCase.inputState), timeout]),
      );

      const pass = testCase.expectedResultCheck(finalState as Record<string, unknown>);
      console.log(`  ${pass ? "PASS" : "FAIL"}`);

      verdicts.push({
        case_id: testCase.name,
        category: "execution",
        executor_model: label,
        judge_model: label,
        provider: executorRef.provider,
        pass,
        judged_by: "exact",
        detail: pass
          ? `matched expectation: ${testCase.expectedResultDescription}`
          : `did not match expectation: ${testCase.expectedResultDescription}. finalState: ${JSON.stringify(finalState).slice(0, 300)}`,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        duration_ms: usage.durationMs,
        run_id: runId,
      });
    } catch (error) {
      const detail = `threw: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`  ERROR — ${detail}`);
      verdicts.push({
        case_id: testCase.name,
        category: "execution",
        executor_model: label,
        judge_model: label,
        provider: executorRef.provider,
        pass: false,
        judged_by: "exact",
        detail,
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: 0,
        run_id: runId,
      });
    }
  }

  await hive.unregister("counter");
  await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  return verdicts;
}
