import { ResponseBuilder } from "../../../core/api/response.ts";
import { createEmptyGraph } from "../../../core/ai/visual-builder/graph-factory.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";

const DEFAULT_NAME = "Untitled execution";

export async function createExecution(
  db: AppDatabase,
  name: string | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    const now = Date.now();
    const execution = await repo.create({
      name: name?.trim() || DEFAULT_NAME,
      createdAt: now,
      updatedAt: now,
    });

    const graph = createEmptyGraph();
    const saved = await repo.createGraph({
      executionId: execution.id,
      graph,
      state: graph.stateSchema,
      createdAt: now,
    });
    await repo.update(execution.id, { lastGraphId: saved.id });

    return ResponseBuilder.success(
      { executionId: execution.id, graphId: saved.id, graph },
      { headers, status: 201 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to create execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
