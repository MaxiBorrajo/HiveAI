import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { parseJsonBody } from "../../../core/api/request.ts";
import {
  OllamaRestartError,
  type OllamaServerEnv,
  restartOllamaService,
} from "../../../core/ollama/restart-ollama-service.ts";
import { ModelSetting, ModelSettingValue } from "../types.ts";
import {
  readModelSettings,
  writeModelSettings,
} from "../lib/settings-store.ts";
import { validateModelSettings } from "../lib/validate-model-settings.ts";

export class InvalidModelSettingsError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(", "));
  }
}

function desiredServerEnv(settings: ModelSetting[]): OllamaServerEnv {
  const value = (name: string) =>
    settings.find((s) => s.name === name)?.currentValue;
  const kvCacheType = value("kv_cache_type");

  return {
    OLLAMA_KV_CACHE_TYPE:
      typeof kvCacheType === "string" && kvCacheType ? kvCacheType : null,
    OLLAMA_FLASH_ATTENTION: value("flash_attention") === true ? "1" : null,
  };
}

function isServerEnvApplied(
  hive: HiveMicrokernel,
  desired: OllamaServerEnv,
): boolean {
  const config = hive.getConfig();
  return (
    (config.get("ollamaKvCacheType") || null) === desired.OLLAMA_KV_CACHE_TYPE &&
    (config.get("ollamaFlashAttention") || null) === desired.OLLAMA_FLASH_ATTENTION
  );
}

export interface ServerEnvStatus {
  pending: boolean;
  kvCacheType: string | null;
  flashAttention: boolean;
}

export async function getServerEnvStatus(
  hive: HiveMicrokernel,
): Promise<ServerEnvStatus> {
  const desired = desiredServerEnv(await readModelSettings());
  const config = hive.getConfig();
  return {
    pending:
      !config.get("ollamaServerPromptDismissed") &&
      !isServerEnvApplied(hive, desired),
    kvCacheType: desired.OLLAMA_KV_CACHE_TYPE,
    flashAttention: desired.OLLAMA_FLASH_ATTENTION === "1",
  };
}

async function applyServerEnv(
  hive: HiveMicrokernel,
  desired: OllamaServerEnv,
): Promise<void> {
  if (isServerEnvApplied(hive, desired)) return;

  try {
    await restartOllamaService(desired);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InvalidModelSettingsError([
      `Failed to restart Ollama with the selected server settings: ${detail}`,
    ]);
  }

  hive.configure({
    ollamaKvCacheType: desired.OLLAMA_KV_CACHE_TYPE ?? "",
    ollamaFlashAttention: desired.OLLAMA_FLASH_ATTENTION ?? "",
  });
}

export async function updateModelSettings(
  hive: HiveMicrokernel,
  incoming: Record<string, ModelSettingValue>,
): Promise<ModelSetting[]> {
  const settings = await readModelSettings();

  const errors = validateModelSettings(incoming, settings);
  if (errors.length > 0) throw new InvalidModelSettingsError(errors);

  for (const setting of settings) {
    if (setting.name in incoming) {
      setting.currentValue = incoming[setting.name] ?? setting.defaultValue;
    }
  }

  const touchesServer = settings.some(
    (s) => s.requiresServiceRestart && s.name in incoming,
  );
  if (touchesServer) await applyServerEnv(hive, desiredServerEnv(settings));
  await writeModelSettings(settings);

  return settings;
}

export async function putModelSettings(
  hive: HiveMicrokernel,
  request: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const parsed = await parseJsonBody<{
    values?: Record<string, ModelSettingValue>;
  }>(request, headers);
  if ("errorResponse" in parsed) return parsed.errorResponse;

  const values = parsed.body?.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return ResponseBuilder.error(["'values' is required"], undefined, {
      headers,
      status: 400,
    });
  }

  try {
    const settings = await updateModelSettings(hive, values);
    return ResponseBuilder.success(settings, { headers });
  } catch (error) {
    if (
      error instanceof InvalidModelSettingsError ||
      error instanceof OllamaRestartError
    ) {
      return ResponseBuilder.error(
        error instanceof InvalidModelSettingsError
          ? error.errors
          : [error.message],
        undefined,
        { headers, status: 400 },
      );
    }
    throw error;
  }
}
