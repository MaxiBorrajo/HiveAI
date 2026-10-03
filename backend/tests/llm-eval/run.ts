
import { HumanMessage, type AIMessage } from "@langchain/core/messages";
import ollama from "ollama";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { initORM } from "../../infrastructure/db/orm.ts";
import CounterPlugin from "../../plugins/counter/index.ts";
import CurrentDatetimePlugin from "../../plugins/current-datetime/index.ts";
import { evalCases, type EvalCase } from "./cases.ts";
import { Scout } from "../../core/ai/strategy/scout/graph.ts";

const AVAILABLE_PLUGINS = [CounterPlugin, CurrentDatetimePlugin];
const MAX_TOOL_CALLS = 5;
const SCOUT_RECURSION_LIMIT = MAX_TOOL_CALLS * 2;

interface CaseOutcome {
  case: EvalCase;
  pass: boolean;
  selectedTool: string | null;
  extractedParams?: Record<string, unknown>;
  detail: string;
}

function extractFirstToolCall(
  messages: unknown[],
): { name: string; args: Record<string, unknown> } | undefined {
  for (const msg of messages) {
    const aiMsg = msg as AIMessage;
    if (aiMsg.type === "ai" && aiMsg.tool_calls?.length) {
      const call = aiMsg.tool_calls[0];
      return { name: call.name, args: call.args as Record<string, unknown> };
    }
  }
  return undefined;
}

async function ensureModelAvailable(model: string): Promise<boolean> {
  try {
    const { models } = await ollama.list();
    return models.some((m) => m.name === model || m.model === model);
  } catch {
    return false;
  }
}

async function runCase(hive: HiveMicrokernel, model: string, testCase: EvalCase): Promise<CaseOutcome> {
  for (const plugin of hive.getRegisteredPlugins()) {
    if (testCase.activePlugins.includes(plugin.name)) {
      await hive.activate(plugin.name);
    } else {
      await hive.deactivate(plugin.name);
    }
  }

  const result = await Scout.invoke(
    {
      messages: [new HumanMessage(testCase.query)],
      chatId: "llm-eval",
      model,
      modelOptions: {},
    },
    { recursionLimit: SCOUT_RECURSION_LIMIT },
  );

  const call = extractFirstToolCall(result.messages ?? []);
  const selectedTool = call?.name ?? null;

  if (testCase.expectedTool === null) {
    const pass = selectedTool === null;
    return {
      case: testCase,
      pass,
      selectedTool,
      detail: pass
        ? "correctly called no tool"
        : `expected no tool call, but got '${selectedTool}'`,
    };
  }

  if (selectedTool !== testCase.expectedTool) {
    return {
      case: testCase,
      pass: false,
      selectedTool,
      detail: `expected '${testCase.expectedTool}', got '${selectedTool ?? "none"}'`,
    };
  }

  if (testCase.expectedParams) {
    const actual = call?.args ?? {};
    const mismatches: string[] = [];
    for (const [key, expected] of Object.entries(testCase.expectedParams)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expected)) {
        mismatches.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual[key])}`);
      }
    }
    if (mismatches.length > 0) {
      return {
        case: testCase,
        pass: false,
        selectedTool,
        extractedParams: actual,
        detail: `param mismatch: ${mismatches.join(", ")}`,
      };
    }
  }

  return {
    case: testCase,
    pass: true,
    selectedTool,
    extractedParams: call?.args,
    detail: "matched expectation",
  };
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
  for (const PluginClass of AVAILABLE_PLUGINS) {
    await hive.register(new PluginClass());
  }

  const outcomes: CaseOutcome[] = [];
  for (const testCase of evalCases) {
    console.log(`Running: ${testCase.name}`);
    try {
      const outcome = await runCase(hive, model, testCase);
      outcomes.push(outcome);
      console.log(`  ${outcome.pass ? "PASS" : "FAIL"} — ${outcome.detail}`);
    } catch (error) {
      outcomes.push({
        case: testCase,
        pass: false,
        selectedTool: null,
        detail: `threw: ${error instanceof Error ? error.message : String(error)}`,
      });
      console.log(`  ERROR — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("\n--- Summary by category ---");
  const categories = [...new Set(evalCases.map((c) => c.category))];
  for (const category of categories) {
    const inCategory = outcomes.filter((o) => o.case.category === category);
    const passed = inCategory.filter((o) => o.pass).length;
    console.log(`${category}: ${passed}/${inCategory.length}`);
  }

  const totalPassed = outcomes.filter((o) => o.pass).length;
  console.log(`\nTotal: ${totalPassed}/${outcomes.length}`);

  await Deno.remove(tempDir, { recursive: true }).catch(() => {});
}

if (import.meta.main) {
  await main();
}
