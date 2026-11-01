import { ResponseBuilder } from "../../../core/api/response.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { ModelUsageRepository } from "../../../infrastructure/db/repositories/model-usage-repository.ts";
import {
  designCallsBefore,
  groupByRun,
  summarizeRunUsage,
} from "../../usage/summarize-run-usage.ts";
import type { RunUsage } from "../../usage/types.ts";
import { RunGradeRepository } from "../../../infrastructure/db/repositories/run-grade-repository.ts";
import { parseRunRecord } from "../parse-run-record.ts";
import { toGradeDto, type RunGradeDto } from "../rubric-types.ts";

export interface RunSummary {
  historyId: number;
  iteration: number;
  createdAt: number;
  graphId: number;
  result: unknown;
  input: Record<string, unknown> | null;
  usage: RunUsage | null;
  grades: RunGradeDto[];
}

export async function loadRunSummaries(
  db: AppDatabase,
  executionId: number,
): Promise<RunSummary[]> {
  const repo = new ExecutionRepository(db);
  const histories = await repo.findHistoriesByExecutionId(executionId);
  const calls = await new ModelUsageRepository(db).listByExecution(
    executionId,
  );
  const callsByRun = groupByRun(calls);
  const gradeRows = await new RunGradeRepository(db).listByHistoryIds(
    histories.map((history) => history.id),
  );

  return histories.map((history) => {
    const record = parseRunRecord(history.result);
    return {
      historyId: history.id,
      iteration: history.iteration,
      createdAt: history.createdAt,
      graphId: history.version,
      result: record.result,
      input: record.run?.input ?? null,
      grades: gradeRows
        .filter((row) => row.grade.historyId === history.id)
        .map((row) => toGradeDto(row.grade, row.rubric)),
      usage: summarizeRunUsage(
        callsByRun.get(history.id) ?? [],
        record.run,
        designCallsBefore(calls, record.run?.startedAt ?? history.createdAt),
      ),
    };
  });
}

export async function listRuns(
  db: AppDatabase,
  executionId: number,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    if (!(await repo.findById(executionId))) {
      return ResponseBuilder.error(["Execution not found"], undefined, {
        headers,
        status: 404,
      });
    }

    const runs = await loadRunSummaries(db, executionId);
    return ResponseBuilder.success({ runs }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to list runs: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
