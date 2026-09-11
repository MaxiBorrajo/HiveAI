import { Hono } from "hono";
import { getModelInfo } from "./useCases/getModelInfo/index.ts";
import { getModels } from "./useCases/getModels/index.ts";
import { getCurrentModels } from "./useCases/getCurrentModels/index.ts";
import { setModels } from "./useCases/setModels/index.ts";
import { getEmbeddingModelStatus } from "./useCases/getEmbeddingModelStatus/index.ts";
import { handlePullEmbeddingModel } from "./useCases/pullEmbeddingModel/index.ts";
import { ModelFilters } from "./types.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";

export const modelsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

modelsRouter.get("/current", (c) => {
  return getCurrentModels(c.get("hive"), {
    "content-type": "application/json",
  });
});

modelsRouter.get("/embedding-status", (c) => {
  return getEmbeddingModelStatus({ "content-type": "application/json" });
});

modelsRouter.post("/embedding-model/pull", (c) => {
  return handlePullEmbeddingModel({ "content-type": "application/json" });
});

modelsRouter.put("/current", async (c) => {
  return setModels(c.get("hive"), c.req.raw, {
    "content-type": "application/json",
  });
});

modelsRouter.get("/", (c) => {
  const query = c.req.query();

  const filters: ModelFilters = {
    name: query.name,
    architecture: query.architecture,
    family: query.family,
    minSizeBytes: query.minSizeBytes ? Number(query.minSizeBytes) : undefined,
    maxSizeBytes: query.maxSizeBytes ? Number(query.maxSizeBytes) : undefined,
    parameterSize: query.parameterSize,
    capabilities: c.req.queries("capabilities"),
  };

  return getModels(filters, { "content-type": "application/json" });
});

modelsRouter.get("/:name", (c) => {
  const name = c.req.param("name");
  return getModelInfo(name, { "content-type": "application/json" });
});
