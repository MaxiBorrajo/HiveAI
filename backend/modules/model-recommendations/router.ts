import { Hono } from "hono";
import { AppError } from "../../core/api/errors.ts";
import { ResponseBuilder } from "../../core/api/response.ts";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { loadCatalog } from "./lib/catalog-store.ts";
import { getRecommendations } from "./recommend-for-task.ts";
import { isTaskType, TASK_LABELS, TASK_TYPES } from "./types.ts";

export const modelRecommendationsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

modelRecommendationsRouter.get("/tasks", () =>
  ResponseBuilder.success(TASK_TYPES.map((id) => ({ id, label: TASK_LABELS[id] }))));

modelRecommendationsRouter.get("/catalog", async () => {
  const { path, customized } = await loadCatalog();
  return ResponseBuilder.success({ path, customized });
});

modelRecommendationsRouter.get("/", async (c) => {
  const task = c.req.query("task");
  if (!isTaskType(task)) throw new AppError("Invalid task", 400);
  return ResponseBuilder.success(await getRecommendations(task, c.get("hive")));
});
