import type { Plugin, PluginTestItem, TestResult } from "@/types/plugin";

export interface PluginTestGroup {
  pluginName: string;
  tests: PluginTestItem[];
}

export function buildPluginTestGroups(plugins: Plugin[]): PluginTestGroup[] {
  return plugins
    .map((plugin) => {
      const tests: PluginTestItem[] = [
        ...(plugin.selectionTests || []).map((t, i) => ({
          ...t,
          type: "selection" as const,
          originalIndex: i,
          label: t.query,
          id: `${plugin.name}-selection-${i}`,
          pluginName: plugin.name,
        })),
        ...(plugin.executionTests || []).map((t, i) => ({
          ...t,
          type: "execution" as const,
          originalIndex: i,
          label: t.description,
          id: `${plugin.name}-execution-${i}`,
          pluginName: plugin.name,
        })),
      ];
      return { pluginName: plugin.name, tests };
    })
    .filter((group) => group.tests.length > 0);
}

export interface TestSummary {
  passed: number;
  passRate: number;
  totalMs: number;
  avgMs: number;
  selectionCount: number;
  selectionPassed: number;
  executionCount: number;
  executionPassed: number;
  totalTokens: number;
  resilienceScore: number;
}

const ROBUSTNESS_KINDS = new Set(["edge", "negative", "error", "ambiguous"]);

export function computeTestSummary(
  tests: PluginTestItem[],
  results: Record<string, TestResult>,
  testsToRunCount: number,
): TestSummary {
  let passed = 0;
  let totalMs = 0;
  let totalTokens = 0;
  let selectionCount = 0;
  let selectionPassed = 0;
  let executionCount = 0;
  let executionPassed = 0;
  let robustnessTotal = 0;
  let robustnessPassed = 0;

  for (const test of tests) {
    const res = results[test.id];
    if (!res) continue;
    const ok = res.status === "success";

    if (ok) passed++;
    totalMs += res.metrics?.durationMs ?? 0;

    if (test.type === "selection") {
      selectionCount++;
      if (ok) selectionPassed++;
      totalTokens +=
        (res.metrics?.inputTokens ?? 0) + (res.metrics?.outputTokens ?? 0);
    } else {
      executionCount++;
      if (ok) executionPassed++;
    }

    if (ROBUSTNESS_KINDS.has(test.kind)) {
      robustnessTotal++;
      if (ok) robustnessPassed++;
    }
  }

  return {
    passed,
    passRate:
      testsToRunCount > 0 ? Math.round((passed / testsToRunCount) * 100) : 0,
    totalMs,
    avgMs: testsToRunCount > 0 ? Math.round(totalMs / testsToRunCount) : 0,
    selectionCount,
    selectionPassed,
    executionCount,
    executionPassed,
    totalTokens,
    resilienceScore:
      robustnessTotal > 0
        ? Math.round((robustnessPassed / robustnessTotal) * 100)
        : 100,
  };
}
