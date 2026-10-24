import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { AppError } from "../../core/api/errors.ts";
import { ResponseBuilder } from "../../core/api/response.ts";
import { getSecretStore } from "../../core/secrets/index.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import { PluginConfigRepository } from "../../infrastructure/db/repositories/plugin-config-repository.ts";
import { getPluginConfig } from "./use-cases/get-plugin-config.ts";
import { setPluginConfig } from "./use-cases/set-plugin-config.ts";
import { deletePluginConfig } from "./use-cases/delete-plugin-config.ts";
import type { PluginConfigDeps } from "./types.ts";

function depsFor(hive: HiveMicrokernel): PluginConfigDeps {
  return {
    repo: new PluginConfigRepository(getORM()),
    secrets: getSecretStore(),
    hive,
  };
}

function handleAppError(error: unknown, headers: Record<string, string>) {
  if (error instanceof AppError) {
    return ResponseBuilder.error([error.message], undefined, {
      status: error.status,
      headers,
    });
  }
  throw error;
}

export async function handleGetPluginConfig(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const fields = await getPluginConfig(depsFor(hive), name);
    return ResponseBuilder.success(fields, { headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
}

export async function handleSetPluginConfig(
  hive: HiveMicrokernel,
  name: string,
  key: string,
  request: Request,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    await setPluginConfig(depsFor(hive), name, key, body.value);
    return ResponseBuilder.success(undefined, { headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
}

export async function handleDeletePluginConfig(
  hive: HiveMicrokernel,
  name: string,
  key: string,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    await deletePluginConfig(depsFor(hive), name, key);
    return ResponseBuilder.success(undefined, { headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
}
