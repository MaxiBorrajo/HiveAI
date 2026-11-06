/**
 * A/B benchmark of the cloud token-saving mechanisms.
 *
 * Runs the same scripted multi-turn conversation (file reads + a memory
 * question) through Scout and reports tokens and estimated cost. It does NOT
 * measure answer quality, only whether the replies contain the expected facts.
 *
 * Run one arm per process (arms live on different branches):
 *
 *   # branch dev (before any mechanism)
 *   ANTHROPIC_KEY_A=sk-... deno run -A scripts/token-savings-benchmark.ts \
 *     --arm dev --key-env ANTHROPIC_KEY_A
 *   # feat branch, mechanisms off (prompt/tools still short)
 *   ... --arm feat-off --savings off --key-env ANTHROPIC_KEY_B
 *   # feat branch, everything on
 *   ... --arm feat-on --savings on --key-env ANTHROPIC_KEY_C
 *   # compare
 *   deno run -A scripts/token-savings-benchmark.ts --compare dev feat-off feat-on
 *
 * `--savings` needs the token-savings module, so it is only valid on the feat
 * branch. Using one API key per arm lets you cross-check the totals against
 * the per-key spend in the Anthropic console.
 */
import { parseArgs } from "@std/cli/parse-args";
import { join } from "node:path";
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { HiveMicrokernel } from "../core/microkernel/hive-microkernel.ts";
import { initORM } from "../infrastructure/db/orm.ts";
import FileReadPlugin from "../plugins/file-read/index.ts";
import { Scout } from "../core/ai/strategy/scout/graph.ts";
import { setSecretResolver } from "../core/ai/providers/create-chat-model.ts";
import {
  setUsageRecorder,
  type UsageEntry,
} from "../core/ai/usage/usage-recorder.ts";

const RESULTS_DIR = new URL("./benchmark-results/", import.meta.url);

// USD per million tokens. Defaults are the published Sonnet-class rates and
// MUST be checked against the current price list; override with the flags.
export const DEFAULT_PRICES = { input: 3, output: 15, cacheReadX: 0.1, cacheWriteX: 1.25 };

export interface Fact {
  file: string;
  codename: string;
}

export interface Totals {
  calls: number;
  freshInput: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

interface ArmResult {
  arm: string;
  model: string;
  runs: { totals: Totals; factsOk: number; factsTotal: number }[];
  prices: typeof DEFAULT_PRICES;
}

const WORDS = [
  "river", "stone", "ember", "violet", "harbor", "falcon", "meadow", "copper",
  "lantern", "willow", "glacier", "saffron", "thistle", "granite", "orchid",
];

/** ~12k chars of deterministic filler with one distinctive codename inside. */
export function buildFixture(index: number): { text: string; fact: Fact; path: string } {
  const codename = `${WORDS[index % WORDS.length]}-${1000 + index * 37}`;
  const lines: string[] = [`# Project dossier ${index + 1}`, ""];
  for (let i = 0; i < 160; i++) {
    lines.push(
      `Section ${i}: ${WORDS[(i + index) % WORDS.length]} operations log, entry ${
        i * 7 + index
      }, status nominal, reviewed by team ${i % 5}.`,
    );
    if (i === 90) lines.push(`The secret codename of this project is ${codename}.`);
  }
  return { text: lines.join("\n"), fact: { file: `dossier-${index + 1}.md`, codename }, path: "" };
}

function lastText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m instanceof AIMessage || m.getType?.() === "ai") {
      const c = m.content;
      return typeof c === "string"
        ? c
        : c.map((p) => ("text" in p ? String(p.text) : "")).join("");
    }
  }
  return "";
}

export function sumUsage(buffer: UsageEntry[]): Totals {
  const totals: Totals = { calls: 0, freshInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  for (const { usage } of buffer) {
    const read = usage.cacheReadTokens ?? 0;
    const write = usage.cacheWriteTokens ?? 0;
    totals.calls++;
    totals.cacheRead += read;
    totals.cacheWrite += write;
    // inputTokens may or may not include cached tokens depending on the provider
    // adapter; the recorder stores the total, so the fresh part is the rest.
    totals.freshInput += Math.max(0, (usage.inputTokens ?? 0) - read - write);
    totals.output += usage.outputTokens ?? 0;
  }
  return totals;
}

async function runConversation(
  ref: { model: string; keyEnv: string },
  facts: Fact[],
  dir: string,
  buffer: UsageEntry[],
): Promise<{ totals: Totals; factsOk: number; factsTotal: number }> {
  const turns: { prompt: string; expects?: string }[] = [
    { prompt: `Read the file ${join(dir, facts[0].file)} and tell me the secret codename.`, expects: facts[0].codename },
    { prompt: `Now read ${join(dir, facts[1].file)} and tell me its secret codename.`, expects: facts[1].codename },
    { prompt: `Now read ${join(dir, facts[2].file)} and tell me its secret codename.`, expects: facts[2].codename },
    { prompt: "Without reading anything again: what was the codename in the first file?", expects: facts[0].codename },
    { prompt: `Read ${join(dir, facts[3].file)} too and give me its codename.`, expects: facts[3].codename },
    { prompt: "List the four codenames you found, in order, in one line.", expects: facts.map((f) => f.codename).join(" ") },
  ];

  buffer.length = 0;
  let history: BaseMessage[] = [];
  let factsOk = 0;
  let factsTotal = 0;
  for (const turn of turns) {
    history = [...history, new HumanMessage(turn.prompt)];
    const result = await Scout.invoke(
      {
        messages: history,
        chatId: "token-benchmark",
        model: ref.model,
        modelProvider: "anthropic",
        modelKeyId: ref.keyEnv,
        modelOptions: {},
      },
      { recursionLimit: 20 },
    );
    history = result.messages as BaseMessage[];
    const answer = lastText(history);
    for (const expected of (turn.expects ?? "").split(" ").filter(Boolean)) {
      factsTotal++;
      if (answer.includes(expected)) factsOk++;
    }
  }

  return { totals: sumUsage(buffer), factsOk, factsTotal };
}

export const cost = (t: Totals, p: typeof DEFAULT_PRICES) =>
  (t.freshInput * p.input +
    t.cacheRead * p.input * p.cacheReadX +
    t.cacheWrite * p.input * p.cacheWriteX +
    t.output * p.output) / 1_000_000;

function avg(results: ArmResult, pick: (t: Totals) => number): number {
  return results.runs.reduce((s, r) => s + pick(r.totals), 0) / results.runs.length;
}

async function compare(arms: string[]): Promise<void> {
  const loaded: ArmResult[] = [];
  for (const arm of arms) {
    loaded.push(JSON.parse(await Deno.readTextFile(new URL(`${arm}.json`, RESULTS_DIR))));
  }
  const base = loaded[0];
  const baseCost = avg(base, (t) => cost(t, base.prices));
  console.log("\narm            calls  fresh_in  cache_read  cache_write  output   cost($)   vs first  facts");
  for (const r of loaded) {
    const c = avg(r, (t) => cost(t, r.prices));
    const facts = r.runs.reduce((s, x) => s + x.factsOk, 0);
    const total = r.runs.reduce((s, x) => s + x.factsTotal, 0);
    const delta = r === base ? "-" : `${(((c - baseCost) / baseCost) * 100).toFixed(1)}%`;
    console.log(
      [
        r.arm.padEnd(14),
        avg(r, (t) => t.calls).toFixed(0).padStart(5),
        avg(r, (t) => t.freshInput).toFixed(0).padStart(9),
        avg(r, (t) => t.cacheRead).toFixed(0).padStart(11),
        avg(r, (t) => t.cacheWrite).toFixed(0).padStart(12),
        avg(r, (t) => t.output).toFixed(0).padStart(7),
        c.toFixed(4).padStart(9),
        delta.padStart(9),
        `${facts}/${total}`.padStart(7),
      ].join(" "),
    );
  }
  console.log(`\n(averages over ${loaded[0].runs.length} run(s); prices ${JSON.stringify(base.prices)})`);
}

async function main() {
  const rawArgs = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
  const args = parseArgs(rawArgs, {
    string: ["arm", "model", "key-env", "savings", "runs", "price-in", "price-out"],
    boolean: ["compare"],
    default: { model: "claude-sonnet-5-5", runs: "3" },
  });

  if (args.compare) {
    await compare(args._.map(String));
    return;
  }

  const arm = args.arm;
  const keyEnv = args["key-env"];
  if (!arm || !keyEnv) {
    console.error("Usage: --arm <name> --key-env <ENV_VAR> [--savings on|off] [--model ...] [--runs 3]");
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

  const result: ArmResult = { arm, model: args.model, runs: [], prices };
  const runs = Number(args.runs);
  for (let i = 0; i < runs; i++) {
    console.log(`[${arm}] run ${i + 1}/${runs}...`);
    const run = await runConversation({ model: args.model, keyEnv }, facts, fixtureDir, buffer);
    console.log(
      `  calls=${run.totals.calls} fresh=${run.totals.freshInput} read=${run.totals.cacheRead} write=${run.totals.cacheWrite} out=${run.totals.output} cost=$${cost(run.totals, prices).toFixed(4)} facts=${run.factsOk}/${run.factsTotal}`,
    );
    result.runs.push(run);
  }

  await Deno.mkdir(RESULTS_DIR, { recursive: true });
  await Deno.writeTextFile(new URL(`${arm}.json`, RESULTS_DIR), JSON.stringify(result, null, 2));
  console.log(`Saved scripts/benchmark-results/${arm}.json`);
}

if (import.meta.main) await main();
