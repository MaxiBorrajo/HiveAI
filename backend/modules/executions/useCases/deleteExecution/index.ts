import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";

export async function deleteExecution(
  db: AppDatabase,
  id: number,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    await repo.delete(id);
    return ResponseBuilder.success({ success: true }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to delete execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}

