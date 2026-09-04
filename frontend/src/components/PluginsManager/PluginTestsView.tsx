import { useState } from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Square, Loader2, Check, X } from "lucide-react";
import type { Plugin } from "@/types/plugin";
import { runPluginTest } from "@/lib/get-plugins";

type TestStatus = "idle" | "running" | "success" | "error";
interface TestResult {
  status: TestStatus;
  errors?: string[];
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

  function toggleTest(id: string) {
    setSelectedTestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
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
          },
        }));
      } catch (err) {
        if (err.name === "AbortError") break;
        setTestResults((prev) => ({
          ...prev,
          [id]: { status: "error", errors: [err.message] },
        }));
      }
    }

    setAbortController(null);
  }

  return (
    <>
      <DialogHeader className="p-4 pb-0 flex flex-row items-center gap-3 space-y-0">
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

      <div className="flex items-center justify-between px-6 py-3 border-y border-border">
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
          className="h-8 text-xs"
        >
          {isRunning ? (
            <Square size={14} className="mr-1.5" />
          ) : (
            <Play size={14} className="mr-1.5" />
          )}
          {isRunning ? "Stop" : "Run Selected"}
        </Button>
      </div>

      <ScrollArea className="flex-1 p-6 pt-4">
        <div className="flex flex-col gap-3">
          {allTests.map((test) => {
            const id = `${test.type}-${test.originalIndex}`;
            const isSelected = selectedTestIds.has(id);
            const res = testResults[id];

            return (
              <label
                key={id}
                className={`flex flex-col gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${isSelected ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleTest(id)}
                    disabled={isRunning}
                    className="size-4 shrink-0 accent-primary mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${test.type === "selection" ? "bg-blue-500/10 text-blue-500" : "bg-green-500/10 text-green-500"}`}
                      >
                        {test.type}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">
                        {test.kind}
                      </span>
                    </div>
                    <p className="text-xs text-foreground font-medium">
                      {test.label}
                    </p>
                    {res?.errors && res.errors.length > 0 && (
                      <ul className="text-[10px] text-destructive list-disc list-inside mt-2">
                        {res.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="shrink-0 mt-1">
                    {res?.status === "running" && (
                      <Loader2
                        size={14}
                        className="animate-spin text-primary"
                      />
                    )}
                    {res?.status === "success" && (
                      <Check size={14} className="text-green-500" />
                    )}
                    {res?.status === "error" && (
                      <X size={14} className="text-destructive" />
                    )}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );
}
