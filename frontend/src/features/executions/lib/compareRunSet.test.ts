import { describe, expect, it } from "vitest";
import { compareRunSet } from "./compareRunSet";
import type { RunGrade, RunSummary } from "../types";

function grade(over: Partial<RunGrade> = {}): RunGrade {
  return {
    historyId: 1,
    status: "graded",
    score: 5,
    reasoning: "ok",
    error: null,
    judge: { provider: "ollama", model: "j", keyId: null, version: 1 },
    rubric: { id: 1, version: 1 },
    createdAt: 1,
    ...over,
  };
}

function run(id: number, over: Partial<RunSummary> = {}): RunSummary {
  return {
    historyId: id,
    iteration: id,
    createdAt: id,
    graphId: 1,
    result: "r",
    input: { q: "same" },
    usage: null,
    grades: [],
    ...over,
  };
}

describe("compareRunSet", () => {
  it("works with no grades at all", () => {
    const out = compareRunSet([run(1), run(2)]);
    expect(out.warnings).toEqual([]);
    expect(out.scores.every((s) => s.grade === null && !s.isBest)).toBe(true);
  });

  it("warns when the inputs differ or were not recorded", () => {
    expect(
      compareRunSet([run(1), run(2, { input: { q: "other" } })]).inputsDiffer,
    ).toBe(true);
    const missing = compareRunSet([run(1), run(2, { input: null })]);
    expect(missing.inputsDiffer).toBe(false);
    expect(missing.inputsNotRecorded).toBe(true);
  });

  it("marks the best score and the distance of the others", () => {
    const out = compareRunSet([
      run(1, { grades: [grade({ score: 4 })] }),
      run(2, { grades: [grade({ historyId: 2, score: 9 })] }),
    ]);
    expect(out.scores[1].isBest).toBe(true);
    expect(out.scores[0].behindBest).toBe(5);
    expect(out.scoresNotComparable).toBe(false);
  });

  it("flags scores from different judges or rubric versions as not comparable", () => {
    const out = compareRunSet([
      run(1, { grades: [grade()] }),
      run(2, { grades: [grade({ judge: { provider: "ollama", model: "other", keyId: null, version: 1 } })] }),
    ]);
    expect(out.scoresNotComparable).toBe(true);
    const rubric = compareRunSet([
      run(1, { grades: [grade()] }),
      run(2, { grades: [grade({ rubric: { id: 2, version: 2 } })] }),
    ]);
    expect(rubric.scoresNotComparable).toBe(true);
  });

  it("leaves a run whose judge failed unevaluated without affecting the rest", () => {
    const out = compareRunSet([
      run(1, { grades: [grade({ score: 7 })] }),
      run(2, { grades: [grade({ status: "failed", score: null, error: "boom" })] }),
    ]);
    expect(out.scores[1].grade?.status).toBe("failed");
    expect(out.scores[1].isBest).toBe(false);
    expect(out.scoresNotComparable).toBe(false);
  });

  it("uses the most recent grade of a run", () => {
    const out = compareRunSet([
      run(1, { grades: [grade({ score: 2, createdAt: 1 }), grade({ score: 8, createdAt: 2 })] }),
      run(2),
    ]);
    expect(out.scores[0].grade?.score).toBe(8);
  });
});
