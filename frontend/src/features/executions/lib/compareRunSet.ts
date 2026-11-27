import type { RunGrade, RunSummary } from "../types";
import { sameInput } from "./compareRuns";

export interface RunScore {
  run: RunSummary;
  /** The most recent grade of the run, if it was ever graded. */
  grade: RunGrade | null;
  /** Null when the run is ungraded, unevaluated or is the best one. */
  behindBest: number | null;
  isBest: boolean;
}

export interface RunSetComparison {
  inputsDiffer: boolean;
  inputsNotRecorded: boolean;
  /** Graded runs were scored with different judges or rubric versions. */
  scoresNotComparable: boolean;
  scores: RunScore[];
  warnings: string[];
}

export function latestGrade(run: RunSummary): RunGrade | null {
  return run.grades.reduce<RunGrade | null>(
    (latest, g) => (!latest || g.createdAt > latest.createdAt ? g : latest),
    null,
  );
}

const gradeKey = (g: RunGrade) =>
  `${g.judge.provider}/${g.judge.model}@v${g.judge.version}|rubric:${g.rubric.id}`;

export function compareRunSet(runs: RunSummary[]): RunSetComparison {
  const recorded = runs.filter((r) => r.input !== null);
  const inputsNotRecorded = recorded.length !== runs.length;
  const inputsDiffer = recorded.some(
    (r) => !sameInput(r.input!, recorded[0].input!),
  );

  const grades = runs.map(latestGrade);
  const scored = grades.filter(
    (g): g is RunGrade => g !== null && g.status === "graded" && g.score !== null,
  );
  const best = scored.reduce((m, g) => Math.max(m, g.score!), -Infinity);
  const scoresNotComparable = new Set(scored.map(gradeKey)).size > 1;

  const scores = runs.map((run, i): RunScore => {
    const grade = grades[i];
    const score = grade?.status === "graded" ? grade.score : null;
    return {
      run,
      grade,
      isBest: score !== null && scored.length > 1 && score === best,
      behindBest: score !== null && scored.length > 1 && score < best ? best - score : null,
    };
  });

  const warnings: string[] = [];
  if (inputsDiffer) {
    warnings.push(
      "The runs were started with different inputs, so the comparison may not be fair.",
    );
  } else if (inputsNotRecorded) {
    warnings.push(
      "The input of some runs was not recorded, so it cannot be checked.",
    );
  }
  if (scoresNotComparable) {
    warnings.push(
      "These scores come from different judges or rubric versions, so they are not directly comparable.",
    );
  }

  return { inputsDiffer, inputsNotRecorded, scoresNotComparable, scores, warnings };
}
