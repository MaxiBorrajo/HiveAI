import { parseId } from "../../core/api/errors.ts";
import { Hono } from "hono";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import {
  requireEmbeddingModelAvailable,
  requireModelsConfigured,
} from "../../core/api/guards.ts";

import { generateExecution } from "./use-cases/generate-execution/generate-execution.ts";
import { listExecutions } from "./use-cases/list-executions.ts";
import { getExecution } from "./use-cases/get-execution.ts";
import { deleteExecution } from "./use-cases/delete-execution.ts";
import { updateExecution } from "./use-cases/update-execution.ts";
import { createExecution } from "./use-cases/create-execution.ts";
import { updateExecutionGraph } from "./use-cases/update-execution-graph.ts";
import { listRuns } from "./use-cases/list-runs.ts";
import { getRubric, saveRubric } from "./use-cases/rubric.ts";
import { gradeRuns } from "./use-cases/grade-runs.ts";
import { getJudgeConversation, judgeChat } from "./use-cases/judge-chat.ts";
import { MAX_FILE_BYTES } from "./portability/flow-format.ts";
import { exportFlow } from "./portability/export-flow.ts";
import { importFlow, previewImport } from "./portability/import-flow.ts";
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
      signal: c.req.raw.signal,
    },
  );
});

async function readFlowUpload(
  form: FormData | undefined,
): Promise<Uint8Array | undefined> {
  const upload = form?.get("file");
  if (!(upload instanceof File) || upload.size > MAX_FILE_BYTES) {
    return undefined;
  }
  return new Uint8Array(await upload.arrayBuffer());
}

executionsRouter.post("/import/preview", async (c) => {
  const headers = { "content-type": "application/json" };
  const form = await c.req.formData().catch(() => undefined);
  return previewImport(
    getORM(),
    c.get("hive"),
    await readFlowUpload(form),
    headers,
  );
});

executionsRouter.post("/import", async (c) => {
  const headers = { "content-type": "application/json" };
  const form = await c.req.formData().catch(() => undefined);
  const conflict = form?.get("conflict");
  let installBundledPlugins: string[] = [];
  try {
    const parsed = JSON.parse(String(form?.get("installBundledPlugins") ?? "[]"));
    if (Array.isArray(parsed)) {
      installBundledPlugins = parsed.filter((n: unknown) => typeof n === "string");
    }
  } catch {
    // Malformed list: install nothing.
  }
  return importFlow(
    getORM(),
    c.get("hive"),
    await readFlowUpload(form),
    {
      conflict: conflict === "new" || conflict === "overwrite" ? conflict : undefined,
      installBundledPlugins,
    },
    headers,
  );
});

executionsRouter.get("/:id/export", async (c) => {
  const headers = { "content-type": "application/json" };
  return exportFlow(getORM(), c.get("hive"), parseId(c.req.param("id")), headers, {
    confirmSecrets: c.req.query("confirmSecrets") === "1",
  });
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

executionsRouter.get("/:id/runs", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  return listRuns(db, parseId(c.req.param("id")), headers);
});

executionsRouter.get("/:id/rubric", async (c) => {
  const headers = { "content-type": "application/json" };
  return getRubric(getORM(), parseId(c.req.param("id")), headers);
});

executionsRouter.put("/:id/rubric", async (c) => {
  const headers = { "content-type": "application/json" };
  const body = await c.req.json().catch(() => ({}));
  return saveRubric(getORM(), parseId(c.req.param("id")), body, headers);
});

executionsRouter.post("/:id/runs/grade", async (c) => {
  const headers = { "content-type": "application/json" };
  const body = await c.req.json().catch(() => ({}));
  return gradeRuns(
    getORM(),
    parseId(c.req.param("id")),
    body,
    headers,
    {},
    c.req.raw.signal,
  );
});

executionsRouter.get("/:id/judge-chat", (c) => {
  return getJudgeConversation(
    getORM(),
    parseId(c.req.param("id")),
    c.req.query("historyIds") ?? "",
    { "content-type": "application/json" },
  );
});

executionsRouter.post("/:id/judge-chat", async (c) => {
  const headers = { "content-type": "application/json" };
  const embeddingGuardError = await requireEmbeddingModelAvailable(headers);
  if (embeddingGuardError) return embeddingGuardError;
  const body = await c.req.json().catch(() => ({}));
  return judgeChat(
    getORM(),
    c.get("hive"),
    parseId(c.req.param("id")),
    body,
    c.req.raw,
    headers,
  );
});

executionsRouter.delete("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  const dataDir = c.get("hive").getConfig().get("dataDir");
  return deleteExecution(db, parseId(c.req.param("id")), headers, dataDir);
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
    c.req.raw.signal,
    Array.isArray(body.attachmentIds) ? body.attachmentIds : [],
  );
});
