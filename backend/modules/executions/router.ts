import { Hono } from "hono";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import { requireModelsConfigured } from "../../core/api/guards.ts";

import { generateExecution } from "./useCases/generateExecution/index.ts";
import { listExecutions } from "./useCases/listExecutions/index.ts";
import { getExecution } from "./useCases/getExecution/index.ts";
import { deleteExecution } from "./useCases/deleteExecution/index.ts";
import { updateExecutionGraph } from "./useCases/updateExecutionGraph/index.ts";
import { runExecution } from "./useCases/runExecution/index.ts";

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
  );
});

executionsRouter.get("/", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  return listExecutions(db, headers);
});

executionsRouter.get("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  return getExecution(db, parseInt(c.req.param("id")), headers);
});

executionsRouter.delete("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  return deleteExecution(db, parseInt(c.req.param("id")), headers);
});

executionsRouter.put("/:id/graph", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  const body = await c.req.json().catch(() => ({}));
  return updateExecutionGraph(
    db,
    parseInt(c.req.param("id")),
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
    parseInt(c.req.param("id")),
    body.input,
    headers,
  );
});
