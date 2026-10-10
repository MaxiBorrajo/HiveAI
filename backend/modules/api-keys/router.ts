import { Hono } from "hono";
import { ResponseBuilder } from "../../core/api/response.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { getSecretStore } from "../../core/secrets/index.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import { ApiKeyRepository } from "../../infrastructure/db/repositories/api-key-repository.ts";
import { ExecutionRepository } from "../../infrastructure/db/repositories/execution-repository.ts";
import { invalidateCloudModelsCache } from "../models/use-cases/get-cloud-models.ts";
import { createUsageFinder } from "./find-api-key-usage.ts";
import { createApiKey } from "./use-cases/create-api-key.ts";
import { ApiKeyInUseError, deleteApiKey } from "./use-cases/delete-api-key.ts";
import { getApiKeyUsage } from "./use-cases/get-api-key-usage.ts";
import { listApiKeys } from "./use-cases/list-api-keys.ts";
import { updateApiKey } from "./use-cases/update-api-key.ts";
import type { ApiKeyDeps } from "./types.ts";

export const apiKeysRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

function depsFor(hive: HiveMicrokernel): ApiKeyDeps {
  const db = getORM();
  return {
    repo: new ApiKeyRepository(db),
    secrets: getSecretStore(),
    findUsage: createUsageFinder(new ExecutionRepository(db), hive.getConfig()),
  };
}

apiKeysRouter.get("/", async (c) =>
  ResponseBuilder.success(await listApiKeys(depsFor(c.get("hive")))),
);

apiKeysRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const created = await createApiKey(depsFor(c.get("hive")), body);
  return ResponseBuilder.success(created, { status: 201 });
});

apiKeysRouter.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const updated = await updateApiKey(
    depsFor(c.get("hive")),
    c.req.param("id"),
    body,
  );
  invalidateCloudModelsCache(updated.id);
  return ResponseBuilder.success(updated);
});

apiKeysRouter.get("/:id/usage", async (c) =>
  ResponseBuilder.success(
    await getApiKeyUsage(depsFor(c.get("hive")), c.req.param("id")),
  ),
);

apiKeysRouter.delete("/:id", async (c) => {
  try {
    await deleteApiKey(
      depsFor(c.get("hive")),
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
