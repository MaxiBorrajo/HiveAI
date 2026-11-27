import { parseArgs } from "@std/cli/parse-args";
import { loadReport } from "./metrics.ts";
import { formatCost } from "./pricing.ts";
import { comparisonToHtml, comparisonToJson, comparisonToMarkdown, compareRuns } from "./report.ts";

type Format = "text" | "json" | "md" | "html";

function isFormat(value: string): value is Format {
  return value === "text" || value === "json" || value === "md" || value === "html";
}

function printText(comparison: ReturnType<typeof compareRuns>): void {
  console.log(`Comparing: ${comparison.runIds.join(", ")}\n`);

  for (const h of comparison.runs) {
    const t = h.totals;
    console.log(
      `${h.runId}: ${h.executorModel}, judge ${h.judgeModels.join(", ") || "-"} — ` +
        `${t.passed}/${t.graded} passed, avg score ${t.avgScore?.toFixed(0) ?? "-"}, ` +
        `${t.inputTokens + t.outputTokens} tokens, ${formatCost(t.costUsd)}, ${(t.durationMs / 1000).toFixed(1)}s`,
    );
  }

  console.log("\nWhat differs:");
  if (comparison.differences.length === 0) console.log("  (nothing recorded)");
  for (const d of comparison.differences) console.log(`  - ${d}`);

  if (comparison.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of comparison.warnings) console.log(`  - ${w}`);
  }

  console.log("\nBy category (pass rate / avg score):");
  for (const c of comparison.categories) {
    const cells = c.perRun.map((s) =>
      s ? `${(s.passRate * 100).toFixed(0)}% / ${s.avgScore?.toFixed(0) ?? "-"}` : "-"
    );
    console.log(`  ${c.category}${c.comparable ? "" : " [not comparable]"}: ${cells.join(" -> ")}`);
  }

  console.log("\nChanged cases:");
  if (comparison.changedCases.length === 0) {
    console.log("  (none)");
  } else {
    for (const c of comparison.changedCases) {
      console.log(`  [${c.kind}] ${c.caseId} (${c.category}): ${c.fromRun} -> ${c.toRun}`);
    }
  }

  if (comparison.unjudgedCases.length > 0) {
    console.log("\nUnjudged (excluded from averages):");
    for (const u of comparison.unjudgedCases) console.log(`  ${u.runId} · ${u.caseId}`);
  }
}

async function main() {
  const rawArgs = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
  const args = parseArgs(rawArgs, {
    string: ["format"],
    default: { format: "text" },
  });

  const paths = args._.map(String);
  if (paths.length < 2) {
    console.error("Usage: deno task eval:compare <a.jsonl> <b.jsonl> [more.jsonl ...] [--format=text|json|md|html]");
    Deno.exit(1);
  }
  if (!isFormat(args.format)) {
    console.error(`Unknown --format '${args.format}'. Expected text, json, md, or html.`);
    Deno.exit(1);
  }

  const runs = await Promise.all(paths.map((p) => loadReport(p)));
  const comparison = compareRuns(runs);

  switch (args.format) {
    case "text":
      printText(comparison);
      break;
    case "json":
      console.log(comparisonToJson(comparison));
      break;
    case "md":
      console.log(comparisonToMarkdown(comparison));
      break;
    case "html":
      console.log(comparisonToHtml(comparison));
      break;
  }
}

if (import.meta.main) {
  await main();
}
