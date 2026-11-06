/**
 * A/B benchmark of the cloud token-saving mechanisms on EXECUTIONS (visual
 * builder graphs). Same arms and flags as token-savings-benchmark.ts; results
 * are saved as `exec-<arm>` and compared with that script:
 *
 *   deno run -A scripts/token-savings-benchmark-executions.ts --arm dev --key-env KEY_A
 *   deno run -A scripts/token-savings-benchmark-executions.ts --arm feat-off --savings off --key-env KEY_B
 *   deno run -A scripts/token-savings-benchmark-executions.ts --arm feat-on --savings on --key-env KEY_C
 *   deno run -A scripts/token-savings-benchmark.ts --compare exec-dev exec-feat-off exec-feat-on
 *
 * Graph: start -> read_ab (reads files 1-2) -> read_cd (reads files 3-4)
 *        -> report (no tools, lists the four codenames) -> end.
 * `--repeat-bait` makes the reading nodes verify by reading again, which gives
 * the duplicate tool-call guard something to block (it only triggers when the
 * model repeats a call).
 */
import { parseArgs } from "@std/cli/parse-args";
import { join } from "node:path";
import { HiveMicrokernel } from "../core/microkernel/hive-microkernel.ts";
import { initORM } from "../infrastructure/db/orm.ts";
import FileReadPlugin from "../plugins/file-read/index.ts";
import { setSecretResolver } from "../core/ai/providers/create-chat-model.ts";
import { setUsageRecorder, type UsageEntry } from "../core/ai/usage/usage-recorder.ts";
import { buildStateSchema, compileGraph } from "../core/ai/visual-builder/execution/compiler.ts";
import { createPluginNodeRegistry } from "../modules/executions/use-cases/run-execution/plugin-node-executor.ts";
import type { LangGraphAbstraction, ToolProvider } from "../core/ai/visual-builder/types.ts";
import {
  buildFixture,
  cost,
  DEFAULT_PRICES,
  type Fact,
  sumUsage,
  type Totals,
} from "./token-savings-benchmark.ts";

const RESULTS_DIR = new URL("./benchmark-results/", import.meta.url);

function buildGraph(model: string, keyEnv: string, bait: boolean): LangGraphAbstraction {
  const llm = (id: string, name: string, extra: Record<string, unknown>) => ({
    id,
    name,
    type: "llm" as const,
    config: { model, provider: "anthropic", keyId: keyEnv, think: false, ...extra },
  });
  const readPrompt = (which: string) =>
    `Use the file_read tool to read the two files listed under "paths". Each file contains one line "The secret codename of this project is X". ` +
    `Reply with exactly one line per file in the form "<file name>: <codename>" for the ${which} files.` +
    (bait ? " Before replying, read each file a second time to double-check the codename." : "");
  return {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      llm("read_ab", "Read first files", {
        plugins: ["file_read"],
        systemPrompt: readPrompt("first"),
        inputMapping: { paths: "paths_ab" },
        outputKey: "found_ab",
      }),
      llm("read_cd", "Read next files", {
        plugins: ["file_read"],
        systemPrompt: readPrompt("next"),
        inputMapping: { paths: "paths_cd" },
        outputKey: "found_cd",
      }),
      llm("final_answer", "Final answer", {
        systemPrompt:
          "Combine the two lists into one answer listing all four file names with their codenames, one per line, in order.",
        inputMapping: { first: "found_ab", next: "found_cd" },
        outputKey: "report",
      }),
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "read_ab", isConditional: false },
      { id: "e2", source: "read_ab", target: "read_cd", isConditional: false },
      { id: "e3", source: "read_cd", target: "final_answer", isConditional: false },
      { id: "e4", source: "final_answer", target: "end", isConditional: false },
    ],
    stateSchema: {
      paths_ab: { type: "string", required: true },
      paths_cd: { type: "string", required: true },
      found_ab: { type: "string", required: false },
      found_cd: { type: "string", required: false },
      report: { type: "string", required: false },
    },
  } as LangGraphAbstraction;
}

async function main() {
  const rawArgs = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
  const args = parseArgs(rawArgs, {
    string: ["arm", "model", "key-env", "savings", "runs", "price-in", "price-out"],
    boolean: ["repeat-bait"],
    default: { model: "claude-sonnet-5-5", runs: "3" },
  });
  const arm = args.arm;
  const keyEnv = args["key-env"];
  if (!arm || !keyEnv) {
    console.error("Usage: --arm <name> --key-env <ENV_VAR> [--savings on|off] [--repeat-bait] [--runs 3]");
    Deno.exit(1);
  }
  if (!Deno.env.get(keyEnv)) {
    console.error(`Environment variable ${keyEnv} is not set.`);
    Deno.exit(1);
  }
  if (args.savings) {
    // Only exists on the feat branch.
    const mod = await import("../core/ai/token-savings/index.ts");
    mod.setTokenSavingsDefaults(args.savings === "off" ? false : undefined);
  }
  const prices = {
    ...DEFAULT_PRICES,
    ...(args["price-in"] ? { input: Number(args["price-in"]) } : {}),
    ...(args["price-out"] ? { output: Number(args["price-out"]) } : {}),
  };

  setSecretResolver((id) => Promise.resolve(Deno.env.get(id)));
  const buffer: UsageEntry[] = [];
  setUsageRecorder({ record: (e) => (buffer.push(e), Promise.resolve()) });

  const tempDir = await Deno.makeTempDir();
  await initORM(tempDir);
  const hive = HiveMicrokernel.getInstance();
  hive.configure({ dataDir: tempDir, model: args.model });
  await hive.register(new FileReadPlugin());
  await hive.activate("file_read");

  const fixtureDir = await Deno.makeTempDir();
  const facts: Fact[] = [];
  for (let i = 0; i < 4; i++) {
    const f = buildFixture(i);
    await Deno.writeTextFile(join(fixtureDir, f.fact.file), f.text);
    facts.push(f.fact);
  }
  const path = (f: Fact) => join(fixtureDir, f.file);

  const toolProvider: ToolProvider = { getTool: (name: string) => hive.getTool(name) };
  const graph = buildGraph(args.model, keyEnv, args["repeat-bait"]);
  const app = compileGraph(
    graph,
    buildStateSchema(graph.stateSchema),
    createPluginNodeRegistry(hive),
    toolProvider,
  );

  const runs: { totals: Totals; factsOk: number; factsTotal: number }[] = [];
  const total = Number(args.runs);
  for (let i = 0; i < total; i++) {
    console.log(`[exec-${arm}] run ${i + 1}/${total}...`);
    buffer.length = 0;
    const state = (await app.invoke({
      paths_ab: `${path(facts[0])}\n${path(facts[1])}`,
      paths_cd: `${path(facts[2])}\n${path(facts[3])}`,
    })) as Record<string, unknown>;
    const report = String(state.report ?? "");
    const factsOk = facts.filter((f) => report.includes(f.codename)).length;
    const totals = sumUsage(buffer);
    console.log(
      `  calls=${totals.calls} fresh=${totals.freshInput} read=${totals.cacheRead} write=${totals.cacheWrite} out=${totals.output} cost=$${
        cost(totals, prices).toFixed(4)
      } facts=${factsOk}/${facts.length}`,
    );
    runs.push({ totals, factsOk, factsTotal: facts.length });
  }

  await Deno.mkdir(RESULTS_DIR, { recursive: true });
  const result = { arm: `exec-${arm}`, model: args.model, runs, prices };
  await Deno.writeTextFile(new URL(`exec-${arm}.json`, RESULTS_DIR), JSON.stringify(result, null, 2));
  console.log(`Saved scripts/benchmark-results/exec-${arm}.json`);
}

if (import.meta.main) await main();
