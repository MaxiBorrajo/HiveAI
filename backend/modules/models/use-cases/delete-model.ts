import { Ollama } from "ollama";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { getCurrentModelRef } from "../../../core/ai/providers/current-model.ts";
import { isModelInUse } from "../../../core/ai/activity-tracker.ts";
import { invalidateLocalNumCtx } from "../../../core/ai/providers/local-context.ts";
import { EMBEDDING_MODEL } from "../../../core/memory/embeddings.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { getORM } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { findLocalModelUsage } from "./find-model-usage.ts";
import { fetchModelInfo } from "./get-model-info.ts";

export async function deleteModel(
  hive: HiveMicrokernel,
  name: string | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  if (!name) {
    return ResponseBuilder.error(["'name' must be provided"], undefined, {
      headers,
      status: 400,
    });
  }

  if (name.startsWith(EMBEDDING_MODEL)) {
    return ResponseBuilder.error(
      [`'${name}' is the embedding model used for conversation memory and cannot be deleted.`],
      undefined,
      { headers, status: 409 },
    );
  }

  const active = getCurrentModelRef(hive.getConfig());
  if (active.provider === "ollama" && active.model === name) {
    return ResponseBuilder.error(
      [`'${name}' is the active model. Select another model before deleting it.`],
      undefined,
      { headers, status: 409 },
    );
  }

  if (isModelInUse(name)) {
    return ResponseBuilder.error(
      [`'${name}' is being used right now by a chat or an execution. Wait for it to finish and try again.`],
      undefined,
      { headers, status: 409 },
    );
  }

  try {
    await new Ollama().delete({ model: name });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Could not delete '${name}': ${detail}`],
      undefined,
      { headers, status: 502 },
    );
  }
  invalidateLocalNumCtx(name);
  return ResponseBuilder.success({ name }, { headers });
}

export async function getModelDeletionImpact(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  const info = await fetchModelInfo(name);
  if (!info) {
    return ResponseBuilder.error(["Model not found"], undefined, {
      headers,
      status: 404,
    });
  }
  const usage = await findLocalModelUsage(
    new ExecutionRepository(getORM()),
    hive.getConfig(),
    name,
  );
  return ResponseBuilder.success({
    name,
    freedBytes: info.sizeBytes,
    inUseNow: isModelInUse(name),
    isEmbeddingModel: name.startsWith(EMBEDDING_MODEL),
    usage,
  }, { headers });
}
