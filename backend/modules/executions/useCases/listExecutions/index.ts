import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";

export async function listExecutions(
  db: AppDatabase,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    const executions = await repo.findAll();
    return ResponseBuilder.success(executions, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to list executions: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}

