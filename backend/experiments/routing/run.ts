
import { harness } from "./harness.ts";
import { queries } from "./queries.ts";
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";

const { strategy, catalog, runs, model } = parseArgs(Deno.args, {
  string: ["strategy", "catalog", "runs", "model"],
});

if (!strategy || !catalog || !runs || !model) {
  console.error("Faltan parametros");
  Deno.exit(1);
}

const RESULTS_DIR = join(import.meta.dirname!, "results");
const runId = `${new Date().toISOString().slice(0, 10)}-${model.replace(":", "-")}`;
const outputPath = join(RESULTS_DIR, `${runId}.jsonl`);

await Deno.mkdir(RESULTS_DIR, { recursive: true });

for (const query of queries) {
  const verdicts = await harness(
    query,
    model,
    Number(catalog),
    strategy as "tool-calling" | "pipeline" | "plan-execution-verification",
    Number(runs),
  );

  if (!verdicts) continue;

  const lines = verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n";
  await Deno.writeTextFile(outputPath, lines, { append: true });
}

console.log(`Escrito en ${outputPath}`);
