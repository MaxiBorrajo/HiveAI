import { evalCases } from "./cases.ts";
import { generatorEvalCases } from "./generatorCases.ts";
import { buildExecutionCases } from "./executionCases.ts";
import { judgedEvalCases } from "./judgedCases.ts";
import { selectCases } from "./caseSelection.ts";

export type SuiteName = "routing" | "generation" | "execution" | "summarization";

export const ALL_SUITES: SuiteName[] = ["routing", "generation", "execution", "summarization"];

/** Which verdict categories each suite produces — what a profile shows as metrics. */
export const SUITE_CATEGORIES: Record<SuiteName, string[]> = {
  routing: ["routing", "abstention", "param-extraction", "multi-turn", "file-creation"],
  generation: ["generation"],
  execution: ["execution"],
  summarization: ["summarization"],
};

export function suiteOfCategory(category: string): SuiteName | undefined {
  return ALL_SUITES.find((s) => SUITE_CATEGORIES[s].includes(category));
}

/** Functions (e.g. execution cases' graph builders and checks) hash by source. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "function" ? v.toString() : v));
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function suiteCases(suite: SuiteName): unknown[] {
  switch (suite) {
    case "routing":
      return evalCases;
    case "generation":
      return generatorEvalCases;
    case "execution":
      // Built with fixed placeholders so the hash depends only on the case
      // definitions, not on which model or temp dir a run happened to use.
      return buildExecutionCases("<model>", "ollama", undefined, "<dir>");
    case "summarization":
      return judgedEvalCases;
  }
}

/**
 * A short content hash of a suite's case definitions. It changes on its own
 * whenever a case is added, removed or edited, so runs and profiles made on
 * different case sets are detected as not comparable without anyone having
 * to remember to bump a version number.
 */
export async function suiteCasesVersion(suite: SuiteName): Promise<string> {
  return await shortHash(stableStringify(suiteCases(suite)));
}

export async function allCasesVersions(): Promise<Record<SuiteName, string>> {
  const entries = await Promise.all(
    ALL_SUITES.map(async (s) => [s, await suiteCasesVersion(s)] as const),
  );
  return Object.fromEntries(entries) as Record<SuiteName, string>;
}

/** How many cases a run of this suite grades, in full or quick mode — used
 *  to estimate a run's cost up front. */
export function suiteCaseCount(suite: SuiteName, quick = false): number {
  return selectCases(
    suiteCases(suite),
    (c) => (suite === "routing" ? (c as { category: string }).category : suite),
    quick,
  ).length;
}
