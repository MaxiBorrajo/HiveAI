import { loadReport, summarizeByCategory } from "./metrics.ts";

function fmtDelta(value: number, unit = ""): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}${unit}`;
}

async function main() {
  const [pathA, pathB] = Deno.args;
  if (!pathA || !pathB) {
    console.error("Usage: deno task eval:compare <a.jsonl> <b.jsonl>");
    Deno.exit(1);
  }

  const [a, b] = await Promise.all([loadReport(pathA), loadReport(pathB)]);
  const summaryA = new Map(summarizeByCategory(a).map((s) => [s.category, s]));
  const summaryB = new Map(summarizeByCategory(b).map((s) => [s.category, s]));

  const categories = new Set([...summaryA.keys(), ...summaryB.keys()]);

  console.log(`Comparing:\n  A: ${pathA}\n  B: ${pathB}\n`);

  for (const category of categories) {
    const sa = summaryA.get(category);
    const sb = summaryB.get(category);
    if (!sa || !sb) {
      console.log(`${category}: only present in ${sa ? "A" : "B"}, skipping comparison`);
      continue;
    }
    const passRateDeltaPct = (sb.passRate - sa.passRate) * 100;
    const durationDelta = sb.avgDurationMs - sa.avgDurationMs;
    const tokensDelta =
      sb.avgInputTokens + sb.avgOutputTokens - (sa.avgInputTokens + sa.avgOutputTokens);
    console.log(
      `${category}: pass rate ${(sa.passRate * 100).toFixed(0)}% -> ${(sb.passRate * 100).toFixed(0)}% ` +
        `(${fmtDelta(passRateDeltaPct, "pp")}), ` +
        `latency ${sa.avgDurationMs}ms -> ${sb.avgDurationMs}ms (${fmtDelta(durationDelta, "ms")}), ` +
        `tokens ${fmtDelta(tokensDelta)}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
