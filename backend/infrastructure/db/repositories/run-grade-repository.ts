import { eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import {
  executionRubrics,
  runGrades,
  type ExecutionRubric,
  type NewRunGrade,
  type RunGrade,
} from "../schema/index.ts";

export interface RunGradeWithRubric {
  grade: RunGrade;
  rubric: ExecutionRubric;
}

export class RunGradeRepository {
  constructor(private db: AppDatabase) {}

  /** Re-grading with the same rubric and judge replaces the previous grade. */
  async upsert(grade: NewRunGrade): Promise<RunGrade> {
    const [row] = await this.db
      .insert(runGrades)
      .values(grade)
      .onConflictDoUpdate({
        target: [
          runGrades.historyId,
          runGrades.rubricId,
          runGrades.judgeProvider,
          runGrades.judgeModel,
        ],
        set: {
          judgeKeyId: grade.judgeKeyId,
          judgeVersion: grade.judgeVersion,
          status: grade.status,
          score: grade.score,
          reasoning: grade.reasoning,
          error: grade.error,
          createdAt: grade.createdAt,
        },
      })
      .returning();
    return row;
  }

  async listByHistoryIds(historyIds: number[]): Promise<RunGradeWithRubric[]> {
    if (historyIds.length === 0) return [];
    const rows = await this.db
      .select({ grade: runGrades, rubric: executionRubrics })
      .from(runGrades)
      .innerJoin(executionRubrics, eq(runGrades.rubricId, executionRubrics.id))
      .where(inArray(runGrades.historyId, historyIds));
    return rows;
  }
}
