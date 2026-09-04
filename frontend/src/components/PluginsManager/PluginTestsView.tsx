import { useState, useMemo } from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Square, Box, Clock, Coins } from "lucide-react";
import type { Plugin } from "@/types/plugin";
import { runPluginTest } from "@/lib/get-plugins";
import { TestCardItem } from "./TestCardItem";

type TestStatus = "idle" | "running" | "success" | "error";
interface TestResult {
  status: TestStatus;
  errors?: string[];
  failureCategory?: string;
  details?: {
    selectedTool?: string | null;
    extractedParams?: Record<string, unknown> | null;
    output?: string | null;
  };
  metrics?: {
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    tokensPerSecond?: number;
  };
}

export function PluginTestsView({
  plugin,
  onBack,
}: {
  plugin: Plugin;
  onBack: () => void;
}) {
  const allTests = [
    ...(plugin.selectionTests || []).map((t, i) => ({
      ...t,
      type: "selection" as const,
      originalIndex: i,
      label: t.query,
    })),
    ...(plugin.executionTests || []).map((t, i) => ({
      ...t,
      type: "execution" as const,
      originalIndex: i,
      label: t.description,
    })),
  ];

  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(
    new Set(allTests.map((t) => `${t.type}-${t.originalIndex}`)),
  );
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {},
  );
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);

  const isRunning = abortController !== null;
  const allSelected =
    allTests.length > 0 && selectedTestIds.size === allTests.length;

  const testsToRunCount = selectedTestIds.size;
  const testsCompletedCount = Object.entries(testResults).filter(
    ([id, res]) =>
      selectedTestIds.has(id) &&
      (res.status === "success" || res.status === "error"),
  ).length;

  const progressPercent =
    testsToRunCount > 0
      ? Math.round((testsCompletedCount / testsToRunCount) * 100)
      : 0;

  const isFinished =
    !isRunning &&
    testsCompletedCount > 0 &&
    testsCompletedCount === testsToRunCount;

  // Compute Summary Metrics
  const summary = useMemo(() => {
    if (!isFinished) return null;
    let passed = 0;
    let totalMs = 0;
    let selectionCount = 0;
    let selectionPassed = 0;
    let executionCount = 0;
    let executionPassed = 0;
    let totalTokens = 0;

    let edgeNegativeTotal = 0;
    let edgeNegativePassed = 0;

    allTests.forEach((t) => {
      const id = `${t.type}-${t.originalIndex}`;
      if (!selectedTestIds.has(id)) return;
      const res = testResults[id];
      if (!res) return;

      if (res.status === "success") passed++;
      if (res.metrics?.durationMs) totalMs += res.metrics.durationMs;

      if (t.type === "selection") {
        selectionCount++;
        if (res.status === "success") selectionPassed++;
        if (res.metrics?.inputTokens) totalTokens += res.metrics.inputTokens;
        if (res.metrics?.outputTokens) totalTokens += res.metrics.outputTokens;
      } else {
        executionCount++;
        if (res.status === "success") executionPassed++;
      }

      if (
        t.kind === "edge" ||
        t.kind === "negative" ||
        t.kind === "error" ||
        t.kind === "ambiguous"
      ) {
        edgeNegativeTotal++;
        if (res.status === "success") edgeNegativePassed++;
      }
    });

    const passRate =
      testsToRunCount > 0 ? Math.round((passed / testsToRunCount) * 100) : 0;
    const resilienceScore =
      edgeNegativeTotal > 0
        ? Math.round((edgeNegativePassed / edgeNegativeTotal) * 100)
        : 100;
    const avgMs =
      testsToRunCount > 0 ? Math.round(totalMs / testsToRunCount) : 0;

    return {
      passed,
      passRate,
      totalMs,
      avgMs,
      selectionCount,
      selectionPassed,
      executionCount,
      executionPassed,
      totalTokens,
      resilienceScore,
    };
  }, [isFinished, testResults, selectedTestIds, allTests, testsToRunCount]);

  function toggleTest(id: string) {
    if (isRunning) return;
    setSelectedTestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (isRunning) return;
    if (allSelected) {
      setSelectedTestIds(new Set());
    } else {
      setSelectedTestIds(
        new Set(allTests.map((t) => `${t.type}-${t.originalIndex}`)),
      );
    }
  }

  async function runSelectedTests() {
    if (isRunning) {
      abortController.abort();
      setAbortController(null);
      return;
    }

    const controller = new AbortController();
    setAbortController(controller);

    setTestResults((prev) => {
      const next = { ...prev };
      Array.from(selectedTestIds).forEach((id) => {
        delete next[id];
      });
      return next;
    });

    const testsToRun = allTests.filter((t) =>
      selectedTestIds.has(`${t.type}-${t.originalIndex}`),
    );

    for (const test of testsToRun) {
      if (controller.signal.aborted) break;

      const id = `${test.type}-${test.originalIndex}`;
      setTestResults((prev) => ({ ...prev, [id]: { status: "running" } }));

      try {
        const res = await runPluginTest(
          plugin.name,
          test.type,
          test.originalIndex,
          controller.signal,
        );
        setTestResults((prev) => ({
          ...prev,
          [id]: {
            status: res.success ? "success" : "error",
            errors: res.errors,
            failureCategory: res.failureCategory,
            details: res.details,
            metrics: res.metrics,
          },
        }));
      } catch (err: any) {
        if (err.name === "AbortError") break;
        setTestResults((prev) => ({
          ...prev,
          [id]: {
            status: "error",
            errors: [err.message],
            failureCategory: "Exception",
          },
        }));
      }
    }
    setAbortController(null);
  }

  return (
    <>
      <DialogHeader className="p-4 flex flex-row items-center gap-3 space-y-0 border-b border-border">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          disabled={isRunning}
          className="shrink-0 -ml-2"
        >
          <ArrowLeft size={16} />
        </Button>
        <div className="flex-1 min-w-0">
          <DialogTitle className="font-mono text-sm">{plugin.name}</DialogTitle>
        </div>
      </DialogHeader>

      {/* Control Bar & Progress */}
      <div className="flex flex-col border-b border-border bg-muted/20">
        <div className="flex items-center justify-between px-6 pb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={isRunning || allTests.length === 0}
              className="size-4 accent-primary"
            />
            <span className="text-xs font-medium">Select all</span>
          </label>

          <Button
            size="sm"
            onClick={runSelectedTests}
            disabled={selectedTestIds.size === 0}
            variant={isRunning ? "destructive" : "default"}
            className="h-8 text-xs font-semibold shadow-sm"
          >
            {isRunning ? (
              <Square size={14} className="mr-1.5 fill-current" />
            ) : (
              <Play size={14} className="mr-1.5 fill-current" />
            )}
            {isRunning ? "Stop" : "Run Selected"}
          </Button>
        </div>

        {/* Progress Bar */}
        {(isRunning || (testsCompletedCount > 0 && !isFinished)) && (
          <div className="flex items-center gap-3 px-6 py-2 bg-muted/10 border-t border-border text-xs font-medium">
            <div className="flex-1 h-2 bg-muted overflow-hidden rounded-full border border-border">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="tabular-nums text-muted-foreground whitespace-nowrap">
              {progressPercent}% ({testsCompletedCount}/{testsToRunCount})
            </span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 p-6 pt-4 bg-muted/10">
        <div className="flex flex-col gap-4">
          {/* Summary Dashboard */}
          {summary && (
            <div className="mb-4 bg-card rounded-xl border border-border shadow-sm p-5 animate-in fade-in slide-in-from-top-4">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Box size={16} className="text-primary" />
                Execution Summary
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div
                  title="Percentage of successful tests across the current run (Passed / Total)"
                  className="flex flex-col gap-1 p-3 bg-muted/30 rounded-lg border border-border/50 cursor-help"
                >
                  <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                    Pass Rate
                  </span>
                  <div className="flex items-end gap-2">
                    <span
                      className={`text-2xl font-bold ${summary.passRate === 100 ? "text-green-500" : summary.passRate > 70 ? "text-orange-500" : "text-red-500"}`}
                    >
                      {summary.passRate}%
                    </span>
                    <span className="text-xs text-muted-foreground font-medium mb-1">
                      {summary.passed}/{testsToRunCount}
                    </span>
                  </div>
                </div>

                <div
                  title="Percentage of Edge, Negative, and Error tests that passed. Measures the plugin's robustness to invalid or tricky inputs."
                  className="flex flex-col gap-1 p-3 bg-muted/30 rounded-lg border border-border/50 cursor-help"
                >
                  <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                    Resilience Score
                  </span>
                  <span
                    className={`text-2xl font-bold ${summary.resilienceScore === 100 ? "text-green-500" : summary.resilienceScore > 70 ? "text-orange-500" : "text-red-500"}`}
                  >
                    {summary.resilienceScore}%
                  </span>
                </div>

                <div
                  title="Average execution time per test in seconds (Total duration / Number of tests)"
                  className="flex flex-col gap-1 p-3 bg-muted/30 rounded-lg border border-border/50 cursor-help"
                >
                  <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                    Avg Latency
                  </span>
                  <div className="flex items-center gap-1.5 text-foreground">
                    <Clock size={16} className="text-muted-foreground" />
                    <span className="text-xl font-bold">
                      {(summary.avgMs / 1000).toFixed(2)}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">
                      s
                    </span>
                  </div>
                </div>

                <div
                  title="Total number of input and output tokens consumed across all Selection tests in this run"
                  className="flex flex-col gap-1 p-3 bg-muted/30 rounded-lg border border-border/50 cursor-help"
                >
                  <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                    Tokens Used
                  </span>
                  <div className="flex items-center gap-1.5 text-foreground">
                    <Coins size={16} className="text-muted-foreground" />
                    <span className="text-xl font-bold">
                      {summary.totalTokens}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 text-xs font-medium">
                <div
                  title="Number of successful LLM Selection tests out of total Selection tests run"
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-md border border-blue-100 cursor-help"
                >
                  <span>Selection:</span>
                  <strong className="font-mono">
                    {summary.selectionPassed}/{summary.selectionCount}
                  </strong>
                </div>
                <div
                  title="Number of successful code Execution tests out of total Execution tests run"
                  className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-md border border-purple-100 cursor-help"
                >
                  <span>Execution:</span>
                  <strong className="font-mono">
                    {summary.executionPassed}/{summary.executionCount}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Test Cards */}
          {allTests.map((test) => {
            const id = `${test.type}-${test.originalIndex}`;
            const isSelected = selectedTestIds.has(id);
            const res = testResults[id];

            return (
              <TestCardItem
                key={id}
                id={id}
                test={test}
                isSelected={isSelected}
                res={res}
                onToggle={toggleTest}
                isRunning={isRunning}
              />
            );
          })}
        </div>
      </ScrollArea>
    </>
  );
}
