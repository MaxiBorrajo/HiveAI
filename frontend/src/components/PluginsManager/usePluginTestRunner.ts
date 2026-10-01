import { useCallback, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import type { PluginTestItem, TestResult } from "@/types/plugin";
import { runPluginTest } from "@/lib/plugins/runPluginTest";
import { toggleInSet } from "@/lib/toggleInSet";
import { computeTestSummary } from "@/lib/plugins/testRunner";

const ABORTED_CATEGORY = "Aborted";

function describeError(err: unknown): string {
  if (isAxiosError(err)) {
    return (
      (err.response?.data as { message?: string } | undefined)?.message ||
      err.message
    );
  }
  return err instanceof Error ? err.message : "Unknown error";
}

export function usePluginTestRunner(allTests: PluginTestItem[]) {
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [runSize, setRunSize] = useState(0);
  const [abortedByUser, setAbortedByUser] = useState(false);

  const isRunning = abortController !== null;
  const selectedIds = useMemo(
    () => new Set(allTests.map((t) => t.id).filter((id) => !deselectedIds.has(id))),
    [allTests, deselectedIds],
  );
  const allSelected = allTests.length > 0 && selectedIds.size === allTests.length;

  const completedCount = Object.entries(results).filter(
    ([id, res]) =>
      selectedIds.has(id) &&
      (res.status === "success" || res.status === "error") &&
      res.failureCategory !== ABORTED_CATEGORY,
  ).length;

  const testsToRunCount = abortedByUser ? completedCount : runSize || selectedIds.size;
  const progressPercent =
    testsToRunCount > 0 ? Math.round((completedCount / testsToRunCount) * 100) : 0;
  const isFinished =
    abortedByUser ||
    (!isRunning && completedCount > 0 && completedCount === testsToRunCount);

  const summary = useMemo(
    () =>
      isFinished
        ? computeTestSummary(
            allTests.filter((t) => selectedIds.has(t.id)),
            results,
            testsToRunCount,
          )
        : null,
    [isFinished, allTests, selectedIds, results, testsToRunCount],
  );

  const toggleTest = useCallback(
    (id: string) => {
      if (isRunning) return;
      setDeselectedIds((prev) => toggleInSet(prev, id));
    },
    [isRunning],
  );

  const toggleAll = useCallback(() => {
    if (isRunning) return;
    setDeselectedIds(allSelected ? new Set(allTests.map((t) => t.id)) : new Set());
  }, [isRunning, allSelected, allTests]);

  const patchResult = (id: string, result: TestResult) =>
    setResults((prev) => ({ ...prev, [id]: result }));

  async function run() {
    if (isRunning) {
      abortController?.abort();
      setAbortController(null);
      setAbortedByUser(true);
      return;
    }

    const controller = new AbortController();
    const testsToRun = allTests.filter((t) => selectedIds.has(t.id));
    setAbortedByUser(false);
    setRunSize(testsToRun.length);
    setAbortController(controller);
    setResults((prev) => {
      const next = { ...prev };
      for (const t of testsToRun) delete next[t.id];
      return next;
    });

    for (const test of testsToRun) {
      if (controller.signal.aborted) break;
      patchResult(test.id, { status: "running" });

      try {
        const { success, errors, data } = await runPluginTest(
          test.pluginName,
          test.type,
          test.originalIndex,
          controller.signal,
        );
        patchResult(test.id, {
          status: success ? "success" : "error",
          errors,
          failureCategory: data?.failureCategory,
          details: data?.details,
          metrics: data?.metrics,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "CanceledError") {
          patchResult(test.id, {
            status: "error",
            errors: ["Test aborted by user."],
            failureCategory: ABORTED_CATEGORY,
          });
          break;
        }
        console.error("Test execution failed:", err);
        patchResult(test.id, {
          status: "error",
          errors: [describeError(err)],
          failureCategory: "Exception",
        });
      }
    }
    setAbortController((current) => (current === controller ? null : current));
  }

  return {
    selectedIds,
    allSelected,
    results,
    isRunning,
    isFinished,
    completedCount,
    testsToRunCount,
    progressPercent,
    summary,
    toggleTest,
    toggleAll,
    run,
  };
}
