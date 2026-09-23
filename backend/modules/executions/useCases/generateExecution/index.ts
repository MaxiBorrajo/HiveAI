import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { generateIncrementalGraph } from "../../../../core/ai/visual-builder/generator.ts";
import type { LangGraphAbstraction } from "../../../../core/ai/visual-builder/types.ts";
import type { BeePlugin } from "../../../../core/microkernel/bee-plugin.ts";

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

        console.log(
          `/executions/generate received. Active bees right now: [${hive
            .getRegisteredPlugins()
            .filter((p: BeePlugin) => hive.isActive(p.name))
            .map((p: BeePlugin) => p.name)
            .join(", ")}]`,
        );
        console.log(
          `[Executions Generator] Model: "${model}" | Execution ID: ${executionId ?? "new"} | Target Node: ${targetNodeId ?? "none"}`,
        );
        console.log(
          `[Executions Generator] Prompt: "${content.length > 100 ? content.slice(0, 97) + "..." : content}"`,
        );

        const availablePlugins = hive.getTools().map((t) => ({
          name: t.name,
          description: t.description,
        }));

        const repo = new ExecutionRepository(db);
        let currentGraph: LangGraphAbstraction | undefined = undefined;
        let targetExecutionId = executionId;

        if (executionId) {
          console.log(
            `[Executions Generator] Looking up existing execution ID: ${executionId}`,
          );
          const existing = await repo.findById(executionId);
          if (existing && existing.lastGraphId) {
            console.log(
              `[Executions Generator] Found existing execution #${executionId} with lastGraphId: ${existing.lastGraphId}`,
            );
            const dbGraph = await repo.findGraphById(existing.lastGraphId);
            if (dbGraph) {
              let parsedGraph = dbGraph.graph;
              if (typeof parsedGraph === "string") {
                try {
                  parsedGraph = JSON.parse(parsedGraph);
                } catch (e) {}
              }
              currentGraph = parsedGraph as LangGraphAbstraction;
              console.log(
                `[Executions Generator] Loaded existing graph with ${currentGraph.nodes?.length ?? 0} nodes and ${currentGraph.edges?.length ?? 0} edges.`,
              );
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
          console.log(
            `[Executions Generator] Created new execution record #${targetExecutionId}: "${newExecution.name}"`,
          );
        }

        send("execution_created", { executionId: targetExecutionId });

        console.log(
          `[Executions Generator] Initializing incremental graph generation stream...`,
        );

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
            console.log(
              `[Executions Generator] Incremental generation completed. Final graph contains ${finalGraph?.nodes?.length ?? 0} nodes and ${finalGraph?.edges?.length ?? 0} edges.`,
            );
            break;
          }

          const event = result.value;
          if (event.type === "planning") {
            console.log(
              `[Executions Generator] [Stream event: planning] Thought: "${event.thoughts}"`,
            );
          } else if (event.type === "node_added") {
            console.log(
              `[Executions Generator] [Stream event: node_added] Node: "${event.node.name}" (${event.node.id}, type: ${event.node.type})${event.edge ? ` <- connected from "${event.edge.source}"` : ""}`,
            );
          } else if (event.type === "node_updated") {
            console.log(
              `[Executions Generator] [Stream event: node_updated] Node: "${event.node.name}" (${event.node.id}, type: ${event.node.type})`,
            );
          }

          send(event.type, event);
        }

        if (finalGraph) {
          console.log(
            `[Executions Generator] Persisting new graph for execution #${targetExecutionId}...`,
          );
          const newGraph = await repo.createGraph({
            executionId: targetExecutionId,
            graph: finalGraph,
            state: finalGraph.stateSchema,
            createdAt: Date.now(),
          });

          await repo.update(targetExecutionId, { lastGraphId: newGraph.id });
          console.log(
            `[Executions Generator] Successfully saved graph #${newGraph.id} for execution #${targetExecutionId}. Emitting 'done' event.`,
          );

          send("done", {
            executionId: targetExecutionId,
            graphId: newGraph.id,
            graph: finalGraph,
          });
        }

        controller.close();
      } catch (error) {
        console.error(
          "[Executions Generator] Error in streaming generation:",
          error,
        );
        const detail = error instanceof Error ? error.message : String(error);
        send("error", { message: detail });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: streamHeaders });
}
