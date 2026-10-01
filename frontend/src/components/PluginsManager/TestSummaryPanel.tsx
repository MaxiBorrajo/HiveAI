import type { ReactNode } from "react";
import { Box, Clock, Coins } from "lucide-react";
import type { TestSummary } from "@/lib/plugins/testRunner";

function StatTile({
  title,
  label,
  children,
}: {
  title: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      title={title}
      className="flex flex-col gap-1 p-3 bg-muted/30 rounded-lg border border-border/50 cursor-help"
    >
      <span className="text-[0.625rem] font-bold uppercase text-muted-foreground tracking-wider">
        {label}
      </span>
      {children}
    </div>
  );
}

function ScoreValue({ value }: { value: number }) {
  return (
    <span
      className={`text-2xl font-bold ${value < 70 ? "text-destructive" : "text-foreground"}`}
    >
      {value}%
    </span>
  );
}

function CountChip({
  title,
  label,
  passed,
  total,
}: {
  title: string;
  label: string;
  passed: number;
  total: number;
}) {
  return (
    <div
      title={title}
      className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 text-foreground rounded-md border border-border cursor-help"
    >
      <span>{label}:</span>
      <strong className="font-mono">
        {passed}/{total}
      </strong>
    </div>
  );
}

export function TestSummaryPanel({
  summary,
  testsToRunCount,
}: {
  summary: TestSummary;
  testsToRunCount: number;
}) {
  return (
    <div className="mb-4 bg-card rounded-xl border border-border shadow-sm p-5 animate-in fade-in slide-in-from-top-4">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Box size={16} className="text-primary" />
        Execution Summary
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatTile
          label="Pass Rate"
          title="Percentage of successful tests across the current run (Passed / Total)"
        >
          <div className="flex items-end gap-2">
            <ScoreValue value={summary.passRate} />
            <span className="text-xs text-muted-foreground font-medium mb-1">
              {summary.passed}/{testsToRunCount}
            </span>
          </div>
        </StatTile>

        <StatTile
          label="Resilience Score"
          title="Percentage of Edge, Negative, and Error tests that passed. Measures the plugin's robustness to invalid or tricky inputs."
        >
          <ScoreValue value={summary.resilienceScore} />
        </StatTile>

        <StatTile
          label="Avg Latency"
          title="Average execution time per test in seconds (Total duration / Number of tests)"
        >
          <div className="flex items-center gap-1.5 text-foreground">
            <Clock size={16} className="text-muted-foreground" />
            <span className="text-xl font-bold">
              {(summary.avgMs / 1000).toFixed(2)}
            </span>
            <span className="text-xs text-muted-foreground font-medium">s</span>
          </div>
        </StatTile>

        <StatTile
          label="Tokens Used"
          title="Total number of input and output tokens consumed across all Selection tests in this run"
        >
          <div className="flex items-center gap-1.5 text-foreground">
            <Coins size={16} className="text-muted-foreground" />
            <span className="text-xl font-bold">{summary.totalTokens}</span>
          </div>
        </StatTile>
      </div>

      <div className="flex gap-4 text-xs font-medium">
        <CountChip
          label="Selection"
          title="Number of successful LLM Selection tests out of total Selection tests run"
          passed={summary.selectionPassed}
          total={summary.selectionCount}
        />
        <CountChip
          label="Execution"
          title="Number of successful code Execution tests out of total Execution tests run"
          passed={summary.executionPassed}
          total={summary.executionCount}
        />
      </div>
    </div>
  );
}
