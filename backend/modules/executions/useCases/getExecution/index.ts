import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";

export async function getExecution(
  db: AppDatabase,
  id: number,
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

    let graph = null;
    if (execution.lastGraphId) {
      const dbGraph = await repo.findGraphById(execution.lastGraphId);
      if (dbGraph) {
        // Compatibility for old executions that were doubly stringified
        if (typeof dbGraph.graph === "string") {
          try {
            dbGraph.graph = JSON.parse(dbGraph.graph);
          } catch (e) {}
        }
        if (typeof dbGraph.state === "string") {
          try {
            dbGraph.state = JSON.parse(dbGraph.state);
          } catch (e) {}
        }
        graph = dbGraph;
      }
    }

    return ResponseBuilder.success({ execution, graph }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to get execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
