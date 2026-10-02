import { parseId } from "../../core/api/errors.ts";
import { Hono } from "hono";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import { requireModelsConfigured } from "../../core/api/guards.ts";

import { generateExecution } from "./use-cases/generate-execution/generate-execution.ts";
import { listExecutions } from "./use-cases/list-executions.ts";
import { getExecution } from "./use-cases/get-execution.ts";
import { deleteExecution } from "./use-cases/delete-execution.ts";
import { updateExecution } from "./use-cases/update-execution.ts";
import { createExecution } from "./use-cases/create-execution.ts";
import { updateExecutionGraph } from "./use-cases/update-execution-graph.ts";
import { runExecution } from "./use-cases/run-execution/run-execution.ts";

export const executionsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

executionsRouter.post("/generate", async (c) => {
  const hive = c.get("hive");
  const config = hive.getConfig();
  const headers = { "content-type": "application/json" };
  const guardError = requireModelsConfigured(hive, headers);
  if (guardError) return guardError;

  const db = getORM();
  const body = await c.req.json().catch(() => ({}));

  return generateExecution(
    db,
    config.get("model"),
    hive,
    body.content,
    body.executionId ? parseInt(body.executionId) : undefined,
    body.targetNodeId,
    headers,
    {
      currentGraph: body.currentGraph,
      dryRun: body.dryRun === true,
    },
  );
});

executionsRouter.post("/", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  const body = await c.req.json().catch(() => ({}));
  return createExecution(db, body.name, headers);
});

executionsRouter.get("/", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  return listExecutions(db, headers);
});

executionsRouter.get("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  return getExecution(db, parseId(c.req.param("id")), headers);
});

executionsRouter.delete("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  return deleteExecution(db, parseId(c.req.param("id")), headers);
});

executionsRouter.patch("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  const body = await c.req.json().catch(() => ({}));
  return updateExecution(db, parseId(c.req.param("id")), body, headers);
});

executionsRouter.put("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  const body = await c.req.json().catch(() => ({}));
  return updateExecution(db, parseId(c.req.param("id")), body, headers);
});

executionsRouter.put("/:id/graph", async (c) => {
  const headers = { "content-type": "application/json" };
  const hive = c.get("hive");
  const db = getORM();
  const body = await c.req.json().catch(() => ({}));
  return updateExecutionGraph(
    db,
    hive,
    parseId(c.req.param("id")),
    body.graph,
    body.stateSchema,
    headers,
  );
});

executionsRouter.post("/:id/run", async (c) => {
  const headers = { "content-type": "application/json" };
  const hive = c.get("hive");
  const db = getORM();
  const body = await c.req.json().catch(() => ({}));
  return runExecution(
    db,
    hive,
    parseId(c.req.param("id")),
    body.input,
    headers,
    body.autoApprove !== false,
  );
});
