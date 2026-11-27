import { ResponseBuilder } from "../../../core/api/response.ts";
import { gradeRun, JUDGE_VERSION, type JudgeDeps } from "../../../core/ai/judge/judge.ts";
import {
  isModelProvider,
  normalizeModelRef,
  type ModelRef,
} from "../../../core/ai/providers/types.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { RubricRepository } from "../../../infrastructure/db/repositories/rubric-repository.ts";
import { RunGradeRepository } from "../../../infrastructure/db/repositories/run-grade-repository.ts";
import { parseRunRecord } from "../parse-run-record.ts";
import { toGradeDto } from "../rubric-types.ts";

export const MAX_GRADED_RUNS = 4;

export interface GradeRunsBody {
  historyIds?: unknown;
  judge?: { provider?: unknown; model?: unknown; keyId?: unknown };
  rubricId?: unknown;
}

function failure(message: string, status: number, headers: Record<string, string>) {
  return ResponseBuilder.error([message], undefined, { headers, status });
}

export function parseJudgeRef(judge: GradeRunsBody["judge"]): ModelRef | null {
  if (!judge || typeof judge.model !== "string" || !judge.model.trim()) return null;
  if (!isModelProvider(judge.provider)) return null;
  return normalizeModelRef(judge.model.trim(), {
    provider: judge.provider,
    keyId: judge.keyId,
  });
}

/**
 * Grades each run in turn. A judge failure is stored as a "failed" grade and
 * never aborts the batch, so the comparison keeps working with what it has.
 */
export async function gradeRuns(
  db: AppDatabase,
  executionId: number,
  body: GradeRunsBody,
  headers: Record<string, string>,
  deps: JudgeDeps = {},
  signal?: AbortSignal,
): Promise<Response> {
  try {
    const historyIds = Array.isArray(body.historyIds)
      ? [...new Set(body.historyIds.filter((id): id is number => Number.isInteger(id)))]
      : [];
    if (historyIds.length === 0 || historyIds.length > MAX_GRADED_RUNS) {
      return failure(`Pick between 1 and ${MAX_GRADED_RUNS} runs to grade.`, 400, headers);
    }
    const judgeRef = parseJudgeRef(body.judge);
    if (!judgeRef) return failure("Pick a judge model.", 400, headers);

    const executions = new ExecutionRepository(db);
    if (!(await executions.findById(executionId))) {
      return failure("Execution not found", 404, headers);
    }

    const rubrics = new RubricRepository(db);
    const rubric = typeof body.rubricId === "number"
      ? await rubrics.findById(body.rubricId)
      : await rubrics.findLatest(executionId);
    if (!rubric || rubric.executionId !== executionId) {
      return failure("Write a rubric for this execution first.", 400, headers);
    }

    const histories = [];
    for (const id of historyIds) {
      const history = await executions.findHistoryById(id);
      if (!history || history.executionId !== executionId) {
        return failure(`Run ${id} does not belong to this execution.`, 400, headers);
      }
      histories.push(history);
    }

    const grades = new RunGradeRepository(db);
    const results = [];
    for (const history of histories) {
      const record = parseRunRecord(history.result);
      const outcome = await gradeRun(
        judgeRef,
        {
          input: record.run?.input ?? null,
          output: record.result,
          rubric: rubric.rubric,
          reference: rubric.reference,
        },
        deps,
        signal,
      );
      const saved = await grades.upsert({
        historyId: history.id,
        rubricId: rubric.id,
        judgeProvider: judgeRef.provider,
        judgeModel: judgeRef.model,
        judgeKeyId: judgeRef.keyId ?? null,
        judgeVersion: JUDGE_VERSION,
        status: outcome.ok ? "graded" : "failed",
        score: outcome.ok ? outcome.score : null,
        reasoning: outcome.ok ? outcome.reasoning : null,
        error: outcome.ok ? null : outcome.error,
        createdAt: Date.now(),
      });
      results.push(toGradeDto(saved, rubric));
    }

    return ResponseBuilder.success({ grades: results }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failure(`Failed to grade the runs: ${detail}`, 500, headers);
  }
}
