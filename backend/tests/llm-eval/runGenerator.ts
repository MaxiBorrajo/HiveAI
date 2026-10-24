import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { initORM } from "../../infrastructure/db/orm.ts";
import type { LangGraphAbstraction, PluginInfo } from "../../core/ai/visual-builder/types.ts";
import type { ModelRef } from "../../core/ai/providers/types.ts";
import WebSearchPlugin from "../../plugins/web-search/index.ts";
import WebReadPlugin from "../../plugins/web-read/index.ts";
import FileOpsPlugin from "../../plugins/file-ops/index.ts";
import CurrentDatetimePlugin from "../../plugins/current-datetime/index.ts";
import CounterPlugin from "../../plugins/counter/index.ts";
import { generatorEvalCases, type GeneratorEvalCase } from "./generatorCases.ts";
import { generateIncrementalGraph } from "../../core/ai/visual-builder/generation/generate-graph.ts";
import { validateGraphAgentToolMentions, validateGraphInterpolationGrammar, validateGraphPluginParameters, validateGraphVariableReferences } from "../../core/ai/visual-builder/generation/validation.ts";
import { modelRefLabel, ensureOllamaModelAvailable } from "./model-ref.ts";
import { captureUsage } from "./usage-capture.ts";
import type { EvalVerdict, EvalLang } from "./metrics.ts";

const ALL_PLUGINS = [WebSearchPlugin, WebReadPlugin, FileOpsPlugin, CurrentDatetimePlugin, CounterPlugin];
const GENERATION_TIMEOUT_MS = 1000_000;

interface CaseOutcome {
  case: GeneratorEvalCase;
  pass: boolean;
  details: string[];
  graph?: LangGraphAbstraction;
}


function toPluginInfo(hive: HiveMicrokernel): PluginInfo[] {
  return hive.getTools().map((t) => {
    const plugin = hive.getPlugin(t.name);
    const shape = (plugin?.schema as any)?.shape;
    const parameterKeys: string[] = [];
    let parametersDescription = "";
    if (shape) {
      parametersDescription = Object.entries(shape)
        .map(([k, v]: [string, any]) => {
          parameterKeys.push(k);
          const isOpt = v.safeParse?.(undefined)?.success ?? false;
          return `${k} (${isOpt ? "optional" : "REQUIRED"})`;
        })
        .join("; ");
    }
    return {
      name: t.name,
      description: t.description,
      parametersDescription,
      parameterKeys,
      returnDescription: (plugin as any)?.returnDescription,
    };
  });
}

async function runCase(
  executorRef: ModelRef,
  availablePlugins: PluginInfo[],
  testCase: GeneratorEvalCase,
  lang: EvalLang,
): Promise<CaseOutcome & { inputTokens: number; outputTokens: number; durationMs: number }> {
  const details: string[] = [];
  const scopedPlugins = availablePlugins.filter((p) => testCase.activePlugins.includes(p.name));
  const prompt = (lang === "es" ? testCase.promptEs : undefined) ?? testCase.prompt;

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`generation exceeded ${GENERATION_TIMEOUT_MS}ms`)), GENERATION_TIMEOUT_MS),
  );

  let graph: LangGraphAbstraction;
  let usage: { inputTokens: number; outputTokens: number; durationMs: number };
  try {
    const captured = await captureUsage(async () => {
      const generator = generateIncrementalGraph(
        prompt,
        executorRef.model,
        scopedPlugins,
        undefined,
        undefined,
        { orchestrator: executorRef, catalog: [] },
      );
      let result = await Promise.race([generator.next(), timeout]);
      while (!result.done) {
        result = await Promise.race([generator.next(), timeout]);
      }
      return result.value as LangGraphAbstraction;
    });
    graph = captured.result;
    usage = captured.usage;
  } catch (err) {
    return {
      case: testCase,
      pass: false,
      details: [`generation threw/timed out: ${err instanceof Error ? err.message : String(err)}`],
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    };
  }

  const intermediateNodes = graph.nodes.filter((n) => n.type !== "start" && n.type !== "end");

  const startCount = graph.nodes.filter((n) => n.type === "start").length;
  const endCount = graph.nodes.filter((n) => n.type === "end").length;
  if (startCount !== 1) details.push(`expected exactly 1 start node, got ${startCount}`);
  if (endCount !== 1) details.push(`expected exactly 1 end node, got ${endCount}`);

  const violations = [
    ...validateGraphInterpolationGrammar(graph),
    ...validateGraphVariableReferences(graph),
    ...validateGraphPluginParameters(graph, availablePlugins),
    ...validateGraphAgentToolMentions(graph, availablePlugins),
  ];
  if (violations.length > 0) {
    details.push(`${violations.length} validation violation(s): ${violations.map((v) => v.reason).join(" | ")}`);
  }

  if (testCase.minIntermediateNodes && intermediateNodes.length < testCase.minIntermediateNodes) {
    details.push(
      `expected at least ${testCase.minIntermediateNodes} intermediate nodes, got ${intermediateNodes.length}`,
    );
  }

  if (testCase.expectedNodeTypes) {
    const presentTypes = new Set(intermediateNodes.map((n) => n.type));
    const missingTypes = testCase.expectedNodeTypes.filter((t) => !presentTypes.has(t));
    if (missingTypes.length > 0) {
      details.push(`missing expected node type(s): [${missingTypes.join(", ")}]`);
    }
  }

  return { case: testCase, pass: details.length === 0, details, graph, ...usage };
}

export async function runGeneratorSuite(
  executorRef: ModelRef,
  runId: string,
  lang: EvalLang = "en",
): Promise<EvalVerdict[]> {
  if (executorRef.provider === "ollama") {
    const available = await ensureOllamaModelAvailable(executorRef.model);
    if (!available) {
      console.log(
        `SKIPPED (generation): Ollama model '${executorRef.model}' is not available. Run 'ollama pull ${executorRef.model}'.`,
      );
      return [];
    }
  }

  const tempDir = await Deno.makeTempDir();
  await initORM(tempDir);

  const hive = HiveMicrokernel.getInstance();
  hive.configure({ dataDir: tempDir, model: executorRef.model });
  for (const PluginClass of ALL_PLUGINS) {
    await hive.register(new PluginClass());
  }
  for (const PluginClass of ALL_PLUGINS) {
    await hive.activate(new PluginClass().name);
  }

  const availablePlugins = toPluginInfo(hive);
  const label = modelRefLabel(executorRef);

  const verdicts: EvalVerdict[] = [];
  for (const testCase of generatorEvalCases) {
    console.log(`\nRunning: ${testCase.name}`);
    const outcome = await runCase(executorRef, availablePlugins, testCase, lang);
    console.log(`  ${outcome.pass ? "PASS" : "FAIL"}`);
    if (!outcome.pass) {
      for (const d of outcome.details) console.log(`    - ${d}`);
    }
    if (outcome.graph) {
      console.log(
        `  graph: ${outcome.graph.nodes.length} nodes, ${outcome.graph.edges.length} edges -> [${outcome.graph.nodes.map((n) => `${n.id}:${n.type}`).join(", ")}]`,
      );
    }
    verdicts.push({
      case_id: testCase.name,
      category: "generation",
      executor_model: label,
      judge_model: label,
      provider: executorRef.provider,
      pass: outcome.pass,
      judged_by: "exact",
      detail: outcome.pass ? "matched expectation" : outcome.details.join(" | "),
      input_tokens: outcome.inputTokens,
      output_tokens: outcome.outputTokens,
      duration_ms: outcome.durationMs,
      run_id: runId,
    });
  }

  await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  return verdicts;
}

async function main() {
  const { parseModelArg, envSecretResolver } = await import("./model-ref.ts");
  const { installInMemoryUsageRecorder } = await import("./usage-capture.ts");
  const { writeReport } = await import("./metrics.ts");
  const { setSecretResolver } = await import("../../core/ai/providers/create-chat-model.ts");

  setSecretResolver(envSecretResolver);
  installInMemoryUsageRecorder();
  const executorRef = parseModelArg(Deno.args[0] ?? "qwen3:8b");
  const runId = `standalone-${Date.now()}`;
  const verdicts = await runGeneratorSuite(executorRef, runId);
  if (verdicts.length > 0) await writeReport(verdicts);
}

if (import.meta.main) {
  await main();
}
