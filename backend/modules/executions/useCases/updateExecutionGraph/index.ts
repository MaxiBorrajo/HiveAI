import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";

export async function updateExecutionGraph(
  db: AppDatabase,
  id: number,
  graph: any,
  stateSchema: any,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    const execution = await repo.findById(id);
    if (!execution) {
      return ResponseBuilder.error(["Execution not found"], undefined, {
        headers,
        status: 404,
      });
    }

    const newGraph = await repo.createGraph({
      executionId: id,
      graph: graph,
      state: stateSchema,
      createdAt: Date.now(),
    });

    await repo.update(id, { lastGraphId: newGraph.id });

    return ResponseBuilder.success(
      { success: true, graphId: newGraph.id },
      { headers },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to update execution graph: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
