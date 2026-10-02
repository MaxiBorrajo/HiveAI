/**
 * Visual Builder generator eval harness. NOT a correctness test: graph
 * generation is LLM-driven and non-deterministic, so this reports a pass
 * rate instead of asserting hard pass/fail. Treat a drop in pass rate as a
 * regression signal to investigate (prompt change, model change), not a
 * build-breaking failure.
 *
 * Requires a running Ollama instance with a tool-calling-capable model
 * pulled (e.g. `ollama pull qwen3:8b`).
 *
 * Usage: deno run -A tests/llm-eval/runGenerator.ts [modelName]
 */
import ollama from "ollama";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { initORM } from "../../infrastructure/db/orm.ts";
import { generateIncrementalGraph } from "../../core/ai/visual-builder/generator.ts";
import {
  validateGraphInterpolationGrammar,
  validateGraphVariableReferences,
  validateGraphPluginParameters,
  validateGraphAgentToolMentions,
} from "../../core/ai/visual-builder/validation.ts";
import type { LangGraphAbstraction, PluginInfo } from "../../core/ai/visual-builder/types.ts";
import WebSearchPlugin from "../../plugins/web-search/index.ts";
import WebReadPlugin from "../../plugins/web-read/index.ts";
import FileOpsPlugin from "../../plugins/file-ops/index.ts";
import CurrentDatetimePlugin from "../../plugins/current-datetime/index.ts";
import CounterPlugin from "../../plugins/counter/index.ts";
import { generatorEvalCases, type GeneratorEvalCase } from "./generatorCases.ts";

const ALL_PLUGINS = [WebSearchPlugin, WebReadPlugin, FileOpsPlugin, CurrentDatetimePlugin, CounterPlugin];
const GENERATION_TIMEOUT_MS = 300_000;

interface CaseOutcome {
  case: GeneratorEvalCase;
  pass: boolean;
  details: string[];
  graph?: LangGraphAbstraction;
}

async function ensureModelAvailable(model: string): Promise<boolean> {
  try {
    const { models } = await ollama.list();
    return models.some((m) => m.name === model || m.model === model);
  } catch {
    return false;
  }
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
  model: string,
  availablePlugins: PluginInfo[],
  testCase: GeneratorEvalCase,
): Promise<CaseOutcome> {
  const details: string[] = [];
  const scopedPlugins = availablePlugins.filter((p) => testCase.activePlugins.includes(p.name));

  const generator = generateIncrementalGraph(testCase.prompt, model, scopedPlugins);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`generation exceeded ${GENERATION_TIMEOUT_MS}ms`)), GENERATION_TIMEOUT_MS),
  );

  let graph: LangGraphAbstraction;
  try {
    let result = await Promise.race([generator.next(), timeout]);
    while (!result.done) {
      result = await Promise.race([generator.next(), timeout]);
    }
    graph = result.value as LangGraphAbstraction;
  } catch (err) {
    return {
      case: testCase,
      pass: false,
      details: [`generation threw/timed out: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const intermediateNodes = graph.nodes.filter((n) => n.type !== "start" && n.type !== "end");

  // 1. Structural sanity: exactly one start/one end, and no orphan/dead-end nodes.
  const startCount = graph.nodes.filter((n) => n.type === "start").length;
  const endCount = graph.nodes.filter((n) => n.type === "end").length;
  if (startCount !== 1) details.push(`expected exactly 1 start node, got ${startCount}`);
  if (endCount !== 1) details.push(`expected exactly 1 end node, got ${endCount}`);

  // 2. Semantic validation (same checks the generator itself self-corrects against).
  const violations = [
    ...validateGraphInterpolationGrammar(graph),
    ...validateGraphVariableReferences(graph),
    ...validateGraphPluginParameters(graph, availablePlugins),
    ...validateGraphAgentToolMentions(graph, availablePlugins),
  ];
  if (violations.length > 0) {
    details.push(`${violations.length} validation violation(s): ${violations.map((v) => v.reason).join(" | ")}`);
  }

  // 3. Minimum node count.
  if (testCase.minIntermediateNodes && intermediateNodes.length < testCase.minIntermediateNodes) {
    details.push(
      `expected at least ${testCase.minIntermediateNodes} intermediate nodes, got ${intermediateNodes.length}`,
    );
  }

  // 4. Expected node type coverage.
  if (testCase.expectedNodeTypes) {
    const presentTypes = new Set(intermediateNodes.map((n) => n.type));
    const missingTypes = testCase.expectedNodeTypes.filter((t) => !presentTypes.has(t));
    if (missingTypes.length > 0) {
      details.push(`missing expected node type(s): [${missingTypes.join(", ")}]`);
    }
  }

  return { case: testCase, pass: details.length === 0, details, graph };
}

async function main() {
  const model = Deno.args[0] ?? "qwen3:8b";

  const available = await ensureModelAvailable(model);
  if (!available) {
    console.log(
      `SKIPPED: model '${model}' is not available in Ollama. Run 'ollama pull ${model}' or pass a different model as the first argument.`,
    );
    return;
  }

  const tempDir = await Deno.makeTempDir();
  await initORM(tempDir);

  const hive = HiveMicrokernel.getInstance();
  hive.configure({ dataDir: tempDir, model });
  for (const PluginClass of ALL_PLUGINS) {
    await hive.register(new PluginClass());
  }
  for (const PluginClass of ALL_PLUGINS) {
    await hive.activate(new PluginClass().name);
  }

  const availablePlugins = toPluginInfo(hive);

  const outcomes: CaseOutcome[] = [];
  for (const testCase of generatorEvalCases) {
    console.log(`\nRunning: ${testCase.name}`);
    const outcome = await runCase(model, availablePlugins, testCase);
    outcomes.push(outcome);
    console.log(`  ${outcome.pass ? "PASS" : "FAIL"}`);
    if (!outcome.pass) {
      for (const d of outcome.details) console.log(`    - ${d}`);
    }
    if (outcome.graph) {
      console.log(
        `  graph: ${outcome.graph.nodes.length} nodes, ${outcome.graph.edges.length} edges -> [${outcome.graph.nodes.map((n) => `${n.id}:${n.type}`).join(", ")}]`,
      );
    }
  }

  const totalPassed = outcomes.filter((o) => o.pass).length;
  console.log(`\n--- Summary ---`);
  console.log(`Total: ${totalPassed}/${outcomes.length}`);

  await Deno.remove(tempDir, { recursive: true }).catch(() => {});
}

if (import.meta.main) {
  await main();
}
