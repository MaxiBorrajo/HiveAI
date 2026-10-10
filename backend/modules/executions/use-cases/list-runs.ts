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
import { parseRunRecord } from "../parse-run-record.ts";

export interface RunSummary {
  historyId: number;
  iteration: number;
  createdAt: number;
  // The version of the graph the run used.
  graphId: number;
  result: unknown;
  // null: nothing about consumption was recorded (run predates the feature).
  usage: RunUsage | null;
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

    const histories = await repo.findHistoriesByExecutionId(executionId);
    const calls = await new ModelUsageRepository(db).listByExecution(
      executionId,
    );
    const callsByRun = groupByRun(calls);

    const runs: RunSummary[] = histories.map((history) => {
      const record = parseRunRecord(history.result);
      return {
        historyId: history.id,
        iteration: history.iteration,
        createdAt: history.createdAt,
        graphId: history.version,
        result: record.result,
        usage: summarizeRunUsage(
          callsByRun.get(history.id) ?? [],
          record.run,
          designCallsBefore(calls, record.run?.startedAt ?? history.createdAt),
        ),
      };
    });

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
