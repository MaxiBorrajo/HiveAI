
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

// Reanudación: si el archivo de esta corrida ya existe, salteamos las consultas
// que ya completaron todas sus repeticiones con esta misma configuración.
const completedQueryIds = new Set<string>();

try {
  const previous = await Deno.readTextFile(outputPath);
  const runsPerQuery = new Map<string, number>();

  for (const line of previous.split("\n")) {
    if (!line.trim()) continue;

    const verdict = JSON.parse(line);

    if (
      verdict.strategy !== strategy ||
      verdict.model !== model ||
      verdict.catalog_size !== Number(catalog)
    ) continue;

    runsPerQuery.set(
      verdict.query_id,
      (runsPerQuery.get(verdict.query_id) ?? 0) + 1,
    );
  }

  for (const [queryId, count] of runsPerQuery) {
    if (count >= Number(runs)) completedQueryIds.add(queryId);
  }

  if (completedQueryIds.size > 0) {
    console.log(
      `Reanudando: ${completedQueryIds.size} consultas ya completas en ${outputPath}`,
    );
  }
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}

for (const query of queries) {
  if (completedQueryIds.has(query.id)) continue;

  const verdicts = await harness(
    query,
    model,
    Number(catalog),
    strategy as
      | "tool-calling"
      | "pipeline"
      | "plan-execution-verification"
      | "plan-execution-verification-granite-selector",
    Number(runs),
  );

  if (!verdicts || verdicts.length === 0) continue;

  const lines = verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n";
  await Deno.writeTextFile(outputPath, lines, { append: true });
}

console.log(`Escrito en ${outputPath}`);
