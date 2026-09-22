import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import {
  executions,
  executionGraphs,
  executionHistory,
} from "../../infrastructure/db/schema/index.ts";
import { generateGraphFromPrompt } from "../../core/ai/visual-builder/generator.ts";
import { requireModelsConfigured } from "../../core/api/guards.ts";
import { compileGraph, buildStateSchema } from "../../core/ai/visual-builder/compiler.ts";
import { LangGraphAbstraction, NodeRegistry, ToolProvider } from "../../core/ai/visual-builder/types.ts";

export const executionsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

executionsRouter.post("/generate", async (c) => {
  const hive = c.get("hive");
  const guardError = requireModelsConfigured(hive, {
    "content-type": "application/json",
  });
  if (guardError) return guardError;

  const body = await c.req.json();
  const prompt = body.prompt;
  const model = body.model;

  if (!prompt || !model) {
    return c.json(
      { error: "Missing 'prompt' or 'model' in request body." },
      400,
    );
  }

  const availablePlugins = hive.getTools().map((t) => ({
    name: t.name,
    description: t.description,
  }));

  try {
    const graph = await generateGraphFromPrompt(
      prompt,
      model,
      availablePlugins,
    );

    const db = getORM();

    // 1. Create a new Execution
    const [newExecution] = await db
      .insert(executions)
      .values({
        name: prompt.substring(0, 50) + (prompt.length > 50 ? "..." : ""),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning();

    // 2. Create the Execution Graph (Version 1)
    const [newGraph] = await db
      .insert(executionGraphs)
      .values({
        executionId: newExecution.id,
        graph: graph as any,
        state: graph.stateSchema as any,
        createdAt: Date.now(),
      })
      .returning();

    // 3. Link graph back to execution
    await db
      .update(executions)
      .set({ lastGraphId: newGraph.id })
      .where(eq(executions.id, newExecution.id));

    return c.json(
      {
        executionId: newExecution.id,
        graphId: newGraph.id,
        graph: graph,
      },
      201,
    );
  } catch (error: any) {
    console.error("[Executions API] Error generating graph:", error);
    return c.json({ error: error.message }, 500);
  }
});

executionsRouter.get("/", async (c) => {
  const db = getORM();
  try {
    const list = await db.select().from(executions);
    return c.json(list);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

executionsRouter.get("/:id", async (c) => {
  const db = getORM();
  const id = parseInt(c.req.param("id"));

  try {
    const [execution] = await db.select().from(executions).where(eq(executions.id, id));
    if (!execution) return c.json({ error: "Execution not found" }, 404);

    let graph = null;
    if (execution.lastGraphId) {
      const [g] = await db.select().from(executionGraphs).where(eq(executionGraphs.id, execution.lastGraphId));
      graph = g;
    }

    return c.json({ execution, graph });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

executionsRouter.delete("/:id", async (c) => {
  const db = getORM();
  const id = parseInt(c.req.param("id"));

  try {
    await db.delete(executions).where(eq(executions.id, id));
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

executionsRouter.put("/:id/graph", async (c) => {
  const db = getORM();
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const { graph, stateSchema } = body;

  try {
    const [execution] = await db.select().from(executions).where(eq(executions.id, id));
    if (!execution) return c.json({ error: "Execution not found" }, 404);

    const [newGraph] = await db
      .insert(executionGraphs)
      .values({
        executionId: id,
        graph: graph,
        state: stateSchema,
        createdAt: Date.now(),
      })
      .returning();

    await db
      .update(executions)
      .set({ lastGraphId: newGraph.id, updatedAt: Date.now() })
      .where(eq(executions.id, id));

    return c.json({ success: true, graphId: newGraph.id });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});



executionsRouter.post("/:id/run", async (c) => {
  const hive = c.get("hive");
  const db = getORM();
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const inputState = body.input || {};

  try {
    const [execution] = await db.select().from(executions).where(eq(executions.id, id));
    if (!execution || !execution.lastGraphId) {
      return c.json({ error: "Execution or graph not found" }, 404);
    }

    const [graphRecord] = await db.select().from(executionGraphs).where(eq(executionGraphs.id, execution.lastGraphId));
    
    const abstraction = {
      nodes: (graphRecord.graph as any).nodes,
      edges: (graphRecord.graph as any).edges,
      stateSchema: graphRecord.state as any,
    } as LangGraphAbstraction;

    const schema = buildStateSchema(abstraction.stateSchema);
    
    // Custom logic registry
    const registry: NodeRegistry = {}; 
    const toolProvider: ToolProvider = {
      getTool: (name: string) => {
        const tool = hive.getTool(name);
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool;
      }
    };

    const app = compileGraph(abstraction, schema, registry, toolProvider);

    const streamHeaders = {
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
          const events = await app.streamEvents(inputState, { version: "v2" });
          let finalState = {};

          for await (const event of events) {
            send(event.event, event);
            if (event.event === "on_chain_end" && event.name === "LangGraph") {
              finalState = event.data.output;
            }
          }

          // Save history
          const [historyRecord] = await db.insert(executionHistory).values({
            executionId: id,
            iteration: 1, // We could count previous iterations
            result: finalState,
            version: graphRecord.id,
            createdAt: Date.now(),
          }).returning();

          await db.update(executions).set({ lastResultId: historyRecord.id, updatedAt: Date.now() }).where(eq(executions.id, id));

          send("done", { historyId: historyRecord.id });
          controller.close();
        } catch (err: any) {
          send("error", { error: err.message });
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: streamHeaders });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});
