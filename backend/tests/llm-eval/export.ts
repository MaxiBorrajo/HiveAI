import { parseArgs } from "@std/cli/parse-args";
import { loadReport } from "./metrics.ts";
import { buildRunReport, reportToHtml, reportToJson, reportToMarkdown } from "./report.ts";

type Format = "json" | "md" | "html";

function isFormat(value: string): value is Format {
  return value === "json" || value === "md" || value === "html";
}

async function main() {
  const rawArgs = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
  const args = parseArgs(rawArgs, {
    string: ["format"],
    default: { format: "json" },
  });

  const [path] = args._.map(String);
  if (!path) {
    console.error("Usage: deno task eval:export <run.jsonl> [--format=json|md|html]");
    Deno.exit(1);
  }
  if (!isFormat(args.format)) {
    console.error(`Unknown --format '${args.format}'. Expected json, md, or html.`);
    Deno.exit(1);
  }

  const verdicts = await loadReport(path);
  const report = buildRunReport(verdicts);

  switch (args.format) {
    case "json":
      console.log(reportToJson(report));
      break;
    case "md":
      console.log(reportToMarkdown(report));
      break;
    case "html":
      console.log(reportToHtml(report));
      break;
  }
}

if (import.meta.main) {
  await main();
}
