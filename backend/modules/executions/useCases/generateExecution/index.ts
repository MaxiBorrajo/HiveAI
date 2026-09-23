import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { generateIncrementalGraph } from "../../../../core/ai/visual-builder/generator.ts";
import type { LangGraphAbstraction } from "../../../../core/ai/visual-builder/types.ts";

export async function generateExecution(
  db: AppDatabase,
  model: string,
  hive: HiveMicrokernel,
  content: string | undefined,
  executionId: number | undefined,
  targetNodeId: string | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  const streamHeaders = {
    ...headers,
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        if (!content) {
          send("error", { message: "Missing 'content' in request body." });
          controller.close();
          return;
        }

        const availablePlugins = hive.getTools().map((t) => ({
          name: t.name,
          description: t.description,
        }));

        const repo = new ExecutionRepository(db);
        let currentGraph: LangGraphAbstraction | undefined = undefined;
        let targetExecutionId = executionId;

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
              currentGraph = parsedGraph as LangGraphAbstraction;
            }
          }
        }

        if (!targetExecutionId) {
          const newExecution = await repo.create({
            name: content.substring(0, 50) + (content.length > 50 ? "..." : ""),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          targetExecutionId = newExecution.id;
        }

        send("execution_created", { executionId: targetExecutionId });

        const generator = generateIncrementalGraph(
          content,
          model,
          availablePlugins,
          currentGraph,
          targetNodeId,
        );

        let finalGraph: LangGraphAbstraction | null = null;

        while (true) {
          const result = await generator.next();
          if (result.done) {
            finalGraph = result.value as LangGraphAbstraction;
            break;
          }
          send(result.value.type, result.value);
        }

        if (finalGraph) {
          const newGraph = await repo.createGraph({
            executionId: targetExecutionId,
            graph: finalGraph,
            state: finalGraph.stateSchema,
            createdAt: Date.now(),
          });

          await repo.update(targetExecutionId, { lastGraphId: newGraph.id });

          send("done", {
            executionId: targetExecutionId,
            graphId: newGraph.id,
            graph: finalGraph,
          });
        }

        controller.close();
      } catch (error) {
        console.error("[Executions API] Error in streaming generation:", error);
        const detail = error instanceof Error ? error.message : String(error);
        send("error", { message: detail });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: streamHeaders });
}
