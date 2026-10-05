import { Hono } from "hono";
import { ResponseBuilder } from "../../core/api/response.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { getSecretStore } from "../../core/secrets/index.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import { ApiKeyRepository } from "../../infrastructure/db/repositories/api-key-repository.ts";
import { ExecutionRepository } from "../../infrastructure/db/repositories/execution-repository.ts";
import { invalidateCloudModelsCache } from "../models/use-cases/get-cloud-models.ts";
import { ApiKeyInUseError, ApiKeyService } from "./api-key-service.ts";
import { createUsageFinder } from "./find-api-key-usage.ts";

export const apiKeysRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

function service(hive: HiveMicrokernel) {
  const db = getORM();
  return new ApiKeyService(
    new ApiKeyRepository(db),
    getSecretStore(),
    createUsageFinder(new ExecutionRepository(db), hive.getConfig()),
  );
}

apiKeysRouter.get("/", async (c) =>
  ResponseBuilder.success(await service(c.get("hive")).list()),
);

apiKeysRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const created = await service(c.get("hive")).create(body);
  return ResponseBuilder.success(created, { status: 201 });
});

apiKeysRouter.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const updated = await service(c.get("hive")).update(c.req.param("id"), body);
  invalidateCloudModelsCache(updated.id);
  return ResponseBuilder.success(updated);
});

apiKeysRouter.get("/:id/usage", async (c) =>
  ResponseBuilder.success(
    await service(c.get("hive")).getUsage(c.req.param("id")),
  ),
);

apiKeysRouter.delete("/:id", async (c) => {
  try {
    await service(c.get("hive")).remove(
      c.req.param("id"),
      c.req.query("force") === "true",
    );
    invalidateCloudModelsCache(c.req.param("id"));
    return ResponseBuilder.success();
  } catch (error) {
    if (error instanceof ApiKeyInUseError) {
      return ResponseBuilder.error([error.message], error.usage, {
        status: 409,
      });
    }
    throw error;
  }
});
