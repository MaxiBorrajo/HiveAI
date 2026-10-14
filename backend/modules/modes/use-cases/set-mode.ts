import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { parseJsonBody } from "../../../core/api/request.ts";
import {
  EMPTY_OLLAMA_SERVER_ENV,
  OllamaRestartError,
  type OllamaServerEnv,
  restartOllamaService,
} from "../../../core/ollama/restart-ollama-service.ts";
import { ChatMode } from "../types.ts";
import {
  readModesConfig,
  writeModesConfig,
} from "../lib/modes-config.ts";
import { calculateRuntimeModes } from "../lib/calculate-runtime-modes.ts";
import { validateModeParameters } from "../lib/validate-mode-parameters.ts";
import { setCurrentMode } from "./set-current-mode.ts";

export class InvalidModeError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(", "));
  }
}

function activeServerEnv(hive: HiveMicrokernel): OllamaServerEnv {
  const config = hive.getConfig();
  return {
    OLLAMA_KV_CACHE_TYPE: config.get("ollamaKvCacheType") || null,
    OLLAMA_FLASH_ATTENTION: config.get("ollamaFlashAttention") || null,
  };
}

function desiredServerEnv(
  incoming: ChatMode,
  referenceMode: ChatMode,
): OllamaServerEnv {
  const restartable = new Set(
    (referenceMode.parameters ?? [])
      .filter((p) => p.requiresServiceRestart)
      .map((p) => p.name),
  );
  const value = (name: string) =>
    restartable.has(name)
      ? (incoming.parameters ?? []).find((p) => p.name === name)?.currentValue
      : undefined;

  const kvCacheType = value("kv_cache_type");
  const flashAttention = value("flash_attention");

  return {
    OLLAMA_KV_CACHE_TYPE:
      typeof kvCacheType === "string" && kvCacheType ? kvCacheType : null,
    OLLAMA_FLASH_ATTENTION: flashAttention === true ? "1" : null,
  };
}

async function applyServerEnv(
  hive: HiveMicrokernel,
  desired: OllamaServerEnv,
  failureLabel: string,
): Promise<void> {
  const active = activeServerEnv(hive);
  if (
    active.OLLAMA_KV_CACHE_TYPE === desired.OLLAMA_KV_CACHE_TYPE &&
    active.OLLAMA_FLASH_ATTENTION === desired.OLLAMA_FLASH_ATTENTION
  ) {
    return;
  }

  try {
    await restartOllamaService(desired);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InvalidModeError([
      `Failed to restart Ollama ${failureLabel}: ${detail}`,
    ]);
  }

  hive.configure({
    ollamaKvCacheType: desired.OLLAMA_KV_CACHE_TYPE ?? "",
    ollamaFlashAttention: desired.OLLAMA_FLASH_ATTENTION ?? "",
  });
}

export async function clearKvCacheOverride(
  hive: HiveMicrokernel,
): Promise<void> {
  await applyServerEnv(
    hive,
    EMPTY_OLLAMA_SERVER_ENV,
    "to clear its server overrides",
  );
}

async function applyServiceRestartParameters(
  hive: HiveMicrokernel,
  incoming: ChatMode,
  referenceMode: ChatMode,
): Promise<void> {
  await applyServerEnv(
    hive,
    desiredServerEnv(incoming, referenceMode),
    "with the selected server parameters",
  );
}

export async function updateMode(
  hive: HiveMicrokernel,
  incoming: ChatMode,
): Promise<ChatMode[]> {
  const modes = await readModesConfig();
  const targetMode = modes.find((m) => m.name === incoming.name);

  if (!targetMode) {
    throw new InvalidModeError([`Unknown mode '${incoming.name}'`]);
  }

  const config = hive.getConfig();

  if (!config.get("model") && incoming.name !== "default") {
    throw new InvalidModeError([
      "No model is configured. Select a model before switching to a mode other than 'default'.",
    ]);
  }

  const [referenceMode] = await calculateRuntimeModes(
    [targetMode],
    config.get("model"),
    config.get("currentMode"),
  );

  const errors = validateModeParameters(incoming, referenceMode);
  if (errors.length > 0) {
    throw new InvalidModeError(errors);
  }

  await applyServiceRestartParameters(hive, incoming, referenceMode);

  const incomingParams = new Map(
    (incoming.parameters ?? []).map((p) => [p.name, p.currentValue]),
  );

  for (const parameter of targetMode.parameters ?? []) {
    if (incomingParams.has(parameter.name)) {
      parameter.currentValue = incomingParams.get(parameter.name) ?? null;
    }
  }

  await writeModesConfig(modes);
  setCurrentMode(hive, targetMode.name);

  return modes;
}

export async function setMode(
  hive: HiveMicrokernel,
  request: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const parsed = await parseJsonBody<ChatMode>(request, headers);
  if ("errorResponse" in parsed) return parsed.errorResponse;
  const body = parsed.body;

  if (!body?.name) {
    return ResponseBuilder.error(["'name' is required"], undefined, {
      headers,
      status: 400,
    });
  }

  try {
    const modes = await updateMode(hive, body);
    return ResponseBuilder.success(modes, { headers });
  } catch (error) {
    if (
      error instanceof InvalidModeError ||
      error instanceof OllamaRestartError
    ) {
      return ResponseBuilder.error(
        error instanceof InvalidModeError ? error.errors : [error.message],
        undefined,
        { headers, status: 400 },
      );
    }
    throw error;
  }
}
