import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { generateGraphFromPrompt } from "../../../../core/ai/visual-builder/generator.ts";
import { resolveModelOptions } from "../../../modes/utils/resolve-model-options.ts";

export async function generateExecution(
  db: AppDatabase,
  model: string,
  hive: HiveMicrokernel,
  content: string | undefined,
  executionId: number | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  if (!content) {
    return ResponseBuilder.error(
      ["Missing 'content' in request body."],
      undefined,
      { headers, status: 400 },
    );
  }

  const availablePlugins = hive.getTools().map((t) => ({
    name: t.name,
    description: t.description,
  }));

  try {
    const repo = new ExecutionRepository(db);
    let currentGraph: any = undefined;

    if (executionId) {
      const existing = await repo.findById(executionId);
      if (existing && existing.lastGraphId) {
        const dbGraph = await repo.findGraphById(existing.lastGraphId);
        if (dbGraph) {
          let parsedGraph = dbGraph.graph;
          if (typeof parsedGraph === "string") {
            try {
              parsedGraph = JSON.parse(parsedGraph);
            } catch (e) {}
          }
          currentGraph = parsedGraph;
        }
      }
    }

    const graph = await generateGraphFromPrompt(
      content,
      model,
      availablePlugins,
      currentGraph,
    );

    let targetExecutionId = executionId;

    if (!targetExecutionId) {
      const newExecution = await repo.create({
        name: content.substring(0, 50) + (content.length > 50 ? "..." : ""),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      targetExecutionId = newExecution.id;
    }

    const newGraph = await repo.createGraph({
      executionId: targetExecutionId,
      graph: graph,
      state: graph.stateSchema,
      createdAt: Date.now(),
    });

    await repo.update(targetExecutionId, { lastGraphId: newGraph.id });

    return ResponseBuilder.success(
      {
        executionId: targetExecutionId,
        graphId: newGraph.id,
        graph: graph,
      },
      { headers, status: 201 },
    );
  } catch (error) {
    console.error("[Executions API] Error generating graph:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to generate execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
