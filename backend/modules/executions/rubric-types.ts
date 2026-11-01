import type { ExecutionRubric, RunGrade } from "../../infrastructure/db/schema/index.ts";

export interface RubricDto {
  id: number;
  version: number;
  rubric: string;
  reference: string | null;
  createdAt: number;
}

export interface RunGradeDto {
  historyId: number;
  status: RunGrade["status"];
  score: number | null;
  reasoning: string | null;
  error: string | null;
  judge: { provider: string; model: string; keyId: string | null; version: number };
  rubric: { id: number; version: number };
  createdAt: number;
}

export function toRubricDto(row: ExecutionRubric): RubricDto {
  return {
    id: row.id,
    version: row.version,
    rubric: row.rubric,
    reference: row.reference,
    createdAt: row.createdAt,
  };
}

export function toGradeDto(grade: RunGrade, rubric: ExecutionRubric): RunGradeDto {
  return {
    historyId: grade.historyId,
    status: grade.status,
    score: grade.score,
    reasoning: grade.reasoning,
    error: grade.error,
    judge: {
      provider: grade.judgeProvider,
      model: grade.judgeModel,
      keyId: grade.judgeKeyId,
      version: grade.judgeVersion,
    },
    rubric: { id: rubric.id, version: rubric.version },
    createdAt: grade.createdAt,
  };
}
