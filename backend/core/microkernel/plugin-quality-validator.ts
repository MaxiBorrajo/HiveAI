import type { z } from "zod";
import type {
  BeePlugin,
  ExecutionTestCase,
  ExecutionTestKind,
  SelectionCaseKind,
  SelectionTestCase,
} from "./bee-plugin.ts";

export interface TestSuiteQualityReport {
  valid: boolean;
  total: number;
  counts: Record<string, number>;
  issues: string[];
}

const MIN_TOTAL_SELECT = 9;
const MIN_PER_KIND_SELECT: Record<SelectionCaseKind, number> = {
  positive: 3,
  negative: 3,
  ambiguous: 3,
};

const MIN_TOTAL_EXEC = 9;
const MIN_PER_KIND_EXEC: Record<ExecutionTestKind, number> = {
  happy: 3,
  edge: 3,
  error: 3,
};

export function validatePlugin(beePlugin: BeePlugin<z.ZodType>) {
  const selectionResults = validateSelectionTests(beePlugin.selectionTests);
  const executionResults = validateExecutionTests(
    beePlugin.schema,
    beePlugin.executionTests,
  );

  return {
    valid: selectionResults.valid && executionResults.valid,
    total: selectionResults.total + executionResults.total,
    counts: { ...selectionResults.counts, ...executionResults.counts },
    issues: [...selectionResults.issues, ...executionResults.issues],
  };
}

export function validateExecutionTests<S extends z.ZodType = z.ZodType>(
  schema: S,
  tests: ExecutionTestCase<S>[] = [],
): TestSuiteQualityReport {
  const counts: Record<ExecutionTestKind, number> = {
    happy: 0,
    edge: 0,
    error: 0,
  };
  const issues: string[] = [];

  for (const t of tests) {
    counts[t.kind]++;
    const parsed = schema.safeParse(t.params);

    if (!parsed.success && t.kind !== "error") {
      issues.push(
        `case "${t.description}" has params that do not pass its own schema`,
      );
    }
  }

  if (tests.length < MIN_TOTAL_EXEC) {
    issues.push(`needs at least ${MIN_TOTAL_EXEC} cases, has ${tests.length}`);
  }
  for (const kind of Object.keys(MIN_PER_KIND_EXEC) as ExecutionTestKind[]) {
    if (counts[kind] < MIN_PER_KIND_EXEC[kind]) {
      issues.push(
        `needs at least ${MIN_PER_KIND_EXEC[kind]} "${kind}" cases, has ${counts[kind]}`,
      );
    }
  }

  return { valid: issues.length === 0, total: tests.length, counts, issues };
}

export function validateSelectionTests(
  tests: SelectionTestCase[] = [],
): TestSuiteQualityReport {
  const counts: Record<SelectionCaseKind, number> = {
    positive: 0,
    negative: 0,
    ambiguous: 0,
  };

  for (const t of tests) counts[t.kind]++;

  const issues: string[] = [];

  if (tests.length < MIN_TOTAL_SELECT) {
    issues.push(`needs at least ${MIN_TOTAL_SELECT} cases, has ${tests.length}`);
  }

  for (const kind of Object.keys(MIN_PER_KIND_SELECT) as SelectionCaseKind[]) {
    if (counts[kind] < MIN_PER_KIND_SELECT[kind]) {
      issues.push(
        `needs at least ${MIN_PER_KIND_SELECT[kind]} "${kind}" cases, has ${counts[kind]}`,
      );
    }
  }

  const queries = tests.map((t) => t.query.trim().toLowerCase());
  if (new Set(queries).size !== queries.length) {
    issues.push("duplicate queries found");
  }

  return { valid: issues.length === 0, total: tests.length, counts, issues };
}
