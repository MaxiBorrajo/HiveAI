import { assertEquals } from "@std/assert";
import { z } from "zod";
import {
  validatePlugin,
  validateSelectionTests,
  validateExecutionTests,
} from "./plugin-quality-validator.ts";
import type {
  BeePlugin,
  ExecutionTestCase,
  SelectionTestCase,
} from "./bee-plugin.ts";

const schema = z.object({ name: z.string() });

function selectionCase(overrides: Partial<SelectionTestCase>): SelectionTestCase {
  return { query: "default query", kind: "positive", ...overrides };
}

function executionCase(
  overrides: Partial<ExecutionTestCase<typeof schema>>,
): ExecutionTestCase<typeof schema> {
  return {
    description: "default case",
    kind: "happy",
    params: { name: "x" },
    expect: () => true,
    ...overrides,
  };
}

function nSelectionCases(kind: SelectionTestCase["kind"], n: number): SelectionTestCase[] {
  return Array.from({ length: n }, (_, i) => selectionCase({ kind, query: `${kind} query ${i}` }));
}

function nExecutionCases(
  kind: ExecutionTestCase["kind"],
  n: number,
): ExecutionTestCase<typeof schema>[] {
  return Array.from({ length: n }, (_, i) =>
    executionCase({ kind, description: `${kind} case ${i}` }));
}

function fullSelectionSuite(): SelectionTestCase[] {
  return [
    ...nSelectionCases("positive", 3),
    ...nSelectionCases("negative", 3),
    ...nSelectionCases("ambiguous", 3),
  ];
}

function fullExecutionSuite(): ExecutionTestCase<typeof schema>[] {
  return [
    ...nExecutionCases("happy", 3),
    ...nExecutionCases("edge", 3),
    ...nExecutionCases("error", 3),
  ];
}

// --- validateSelectionTests ---

Deno.test("validateSelectionTests - a suite meeting all minimums (3/3/3, 9 total) is valid", () => {
  const report = validateSelectionTests(fullSelectionSuite());
  assertEquals(report.valid, true);
  assertEquals(report.issues, []);
  assertEquals(report.total, 9);
  assertEquals(report.counts, { positive: 3, negative: 3, ambiguous: 3 });
});

Deno.test("validateSelectionTests - an empty suite reports the total and all three per-kind shortfalls", () => {
  const report = validateSelectionTests([]);
  assertEquals(report.valid, false);
  assertEquals(report.issues.some((i) => i.includes("at least 9 cases")), true);
  assertEquals(report.issues.some((i) => i.includes('"positive"')), true);
  assertEquals(report.issues.some((i) => i.includes('"negative"')), true);
  assertEquals(report.issues.some((i) => i.includes('"ambiguous"')), true);
});

Deno.test("validateSelectionTests - missing just one kind only flags that kind, not the others", () => {
  const report = validateSelectionTests([
    ...nSelectionCases("positive", 3),
    ...nSelectionCases("negative", 3),
    ...nSelectionCases("ambiguous", 0),
  ]);
  assertEquals(report.issues.some((i) => i.includes('"ambiguous"')), true);
  assertEquals(report.issues.some((i) => i.includes('"positive"')), false);
  assertEquals(report.issues.some((i) => i.includes('"negative"')), false);
});

Deno.test("validateSelectionTests - duplicate queries (case/whitespace-insensitive) are flagged", () => {
  const cases = fullSelectionSuite();
  cases[0].query = "  Find The File  ";
  cases[1].query = "find the file";
  const report = validateSelectionTests(cases);
  assertEquals(report.issues.some((i) => i.includes("duplicate queries")), true);
});

Deno.test("validateSelectionTests - no default argument (undefined) behaves like an empty suite", () => {
  const report = validateSelectionTests();
  assertEquals(report.valid, false);
  assertEquals(report.total, 0);
});

// --- validateExecutionTests ---

Deno.test("validateExecutionTests - a suite meeting all minimums (3/3/3, 9 total) with valid params is valid", () => {
  const report = validateExecutionTests(schema, fullExecutionSuite());
  assertEquals(report.valid, true);
  assertEquals(report.issues, []);
  assertEquals(report.counts, { happy: 3, edge: 3, error: 3 });
});

Deno.test("validateExecutionTests - an empty suite reports the total and all three per-kind shortfalls", () => {
  const report = validateExecutionTests(schema, []);
  assertEquals(report.valid, false);
  assertEquals(report.issues.some((i) => i.includes("at least 9 cases")), true);
  assertEquals(report.issues.some((i) => i.includes('"happy"')), true);
  assertEquals(report.issues.some((i) => i.includes('"edge"')), true);
  assertEquals(report.issues.some((i) => i.includes('"error"')), true);
});

Deno.test("validateExecutionTests - a 'happy' or 'edge' case with params that fail the plugin's own schema is flagged", () => {
  const cases = fullExecutionSuite();
  cases[0] = executionCase({ kind: "happy", description: "bad happy case", params: { name: 123 } as any });
  const report = validateExecutionTests(schema, cases);
  assertEquals(
    report.issues.some((i) => i.includes('"bad happy case"') && i.includes("do not pass its own schema")),
    true,
  );
});

Deno.test("validateExecutionTests - an 'error' case with schema-invalid params is NOT flagged (invalid input is the point of an error case)", () => {
  const cases = fullExecutionSuite();
  cases[6] = executionCase({ kind: "error", description: "intentionally bad input", params: { name: 123 } as any });
  const report = validateExecutionTests(schema, cases);
  assertEquals(report.issues.some((i) => i.includes("intentionally bad input")), false);
});

Deno.test("validateExecutionTests - no default argument (undefined) behaves like an empty suite", () => {
  const report = validateExecutionTests(schema);
  assertEquals(report.valid, false);
  assertEquals(report.total, 0);
});

// --- validatePlugin (combines both suites) ---

function fakePlugin(
  overrides: Partial<Pick<BeePlugin, "selectionTests" | "executionTests">> = {},
): BeePlugin {
  return {
    name: "fake",
    description: "fake plugin",
    schema,
    selectionTests: fullSelectionSuite(),
    executionTests: fullExecutionSuite(),
    initialize: () => {},
    process: async () => "ok",
    ...overrides,
  };
}

Deno.test("validatePlugin - valid when both selection and execution suites independently pass", () => {
  const report = validatePlugin(fakePlugin());
  assertEquals(report.valid, true);
  assertEquals(report.issues, []);
});

Deno.test("validatePlugin - invalid when only the selection suite fails", () => {
  const report = validatePlugin(fakePlugin({ selectionTests: [] }));
  assertEquals(report.valid, false);
  assertEquals(report.issues.some((i) => i.includes("at least 9 cases")), true);
});

Deno.test("validatePlugin - invalid when only the execution suite fails", () => {
  const report = validatePlugin(fakePlugin({ executionTests: [] }));
  assertEquals(report.valid, false);
});

Deno.test("validatePlugin - total and counts are the sum/merge of both suites", () => {
  const report = validatePlugin(fakePlugin());
  assertEquals(report.total, 18); // 9 selection + 9 execution
  assertEquals(report.counts, {
    positive: 3,
    negative: 3,
    ambiguous: 3,
    happy: 3,
    edge: 3,
    error: 3,
  });
});
