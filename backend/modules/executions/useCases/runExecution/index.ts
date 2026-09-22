import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import {
  compileGraph,
  buildStateSchema,
} from "../../../../core/ai/visual-builder/compiler.ts";
import type {
  LangGraphAbstraction,
  NodeRegistry,
  ToolProvider,
} from "../../../../core/ai/visual-builder/types.ts";

export async function runExecution(
  db: AppDatabase,
  hive: HiveMicrokernel,
  id: number,
  inputState: any,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    const execution = await repo.findById(id);
    if (!execution || !execution.lastGraphId) {
      return ResponseBuilder.error(
        ["Execution or graph not found"],
        undefined,
        {
          headers,
          status: 404,
        },
      );
    }

    const graphRecord = await repo.findGraphById(execution.lastGraphId);
    if (!graphRecord) {
      return ResponseBuilder.error(["Graph record not found"], undefined, {
        headers,
        status: 404,
      });
    }

    let parsedGraph = graphRecord.graph as any;
    let parsedState = graphRecord.state as any;

    if (typeof parsedGraph === "string") {
      try {
        parsedGraph = JSON.parse(parsedGraph);
      } catch (e) {}
    }
    if (typeof parsedState === "string") {
      try {
        parsedState = JSON.parse(parsedState);
      } catch (e) {}
    }

    const abstraction = {
      nodes: parsedGraph.nodes,
      edges: parsedGraph.edges,
      stateSchema: parsedState,
    } as LangGraphAbstraction;

    const schema = buildStateSchema(abstraction.stateSchema);

    // Custom logic registry
    const registry: NodeRegistry = {};
    const toolProvider: ToolProvider = {
      getTool: (name: string) => {
        const tool = hive.getTool(name);
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool;
      },
    };

    const app = compileGraph(abstraction, schema, registry, toolProvider);

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
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        };

        try {
          const events = await app.streamEvents(inputState || {}, {
            version: "v2",
          });
          let finalState = {};

          for await (const event of events) {
            send(event.event, event);
            if (event.event === "on_chain_end" && event.name === "LangGraph") {
              finalState = event.data.output;
            }
          }

          // Save history
          const historyRecord = await repo.createHistory({
            executionId: id,
            iteration: 1, // We could count previous iterations
            result: JSON.stringify(finalState),
            version: graphRecord.id,
            createdAt: Date.now(),
          });

          await repo.update(id, { lastResultId: historyRecord.id });

          send("done", { historyId: historyRecord.id });
          controller.close();
        } catch (err: any) {
          send("error", { error: err.message });
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: streamHeaders });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to run execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
