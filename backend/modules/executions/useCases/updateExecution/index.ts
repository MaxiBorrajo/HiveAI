import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";

export interface UpdateExecutionDto {
  name?: string;
  title?: string;
}

export async function updateExecution(
  db: AppDatabase,
  id: number,
  dto: UpdateExecutionDto,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    if (isNaN(id)) {
      return ResponseBuilder.error(["Invalid execution id"], undefined, {
        status: 400,
        headers,
      });
    }

    const name = (dto?.name ?? dto?.title)?.trim();
    if (!name) {
      return ResponseBuilder.error(
        ["Execution name is required and cannot be empty"],
        undefined,
        {
          status: 400,
          headers,
        },
      );
    }

    const repo = new ExecutionRepository(db);
    const existing = await repo.findById(id);

    if (!existing) {
      return ResponseBuilder.error([`Execution ${id} not found`], undefined, {
        status: 404,
        headers,
      });
    }

    await repo.update(id, { name });

    const updated = await repo.findById(id);

    return ResponseBuilder.success(
      updated ?? { ...existing, name, updatedAt: Date.now() },
      { headers },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to update execution: ${detail}`],
      undefined,
      {
        status: 500,
        headers,
      },
    );
  }
}
