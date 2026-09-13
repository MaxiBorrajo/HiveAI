import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { parseJsonBody } from "../../../../core/api/request.ts";
import {
  OllamaRestartError,
  restartOllamaService,
} from "../../../../core/restart-ollama-service.ts";
import { ChatMode } from "../../types.ts";
import {
  readModesConfig,
  writeModesConfig,
} from "../../utils/modes-config.ts";
import { calculateRuntimeModes } from "../../utils/calculate-runtime-modes.ts";
import { validateModeParameters } from "../../utils/validate-mode-parameters.ts";
import { setCurrentMode } from "../setCurrentMode/index.ts";

export class InvalidModeError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(", "));
  }
}

export async function clearKvCacheOverride(
  hive: HiveMicrokernel,
): Promise<void> {
  const config = hive.getConfig();
  if (!config.get("ollamaKvCacheType")) return;

  try {
    await restartOllamaService(null);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InvalidModeError([
      `Failed to restart Ollama to clear kv_cache_type: ${detail}`,
    ]);
  }

  hive.configure({ ollamaKvCacheType: "" });
}

async function applyServiceRestartParameters(
  hive: HiveMicrokernel,
  incoming: ChatMode,
  referenceMode: ChatMode,
): Promise<void> {
  const config = hive.getConfig();
  const activeOverride = config.get("ollamaKvCacheType");

  const kvCacheParam = (incoming.parameters ?? []).find(
    (p) => p.name === "kv_cache_type",
  );
  const referenceParam = (referenceMode.parameters ?? []).find(
    (p) => p.name === "kv_cache_type",
  );

  if (!kvCacheParam || !referenceParam?.requiresServiceRestart) {
    return clearKvCacheOverride(hive);
  }

  if (typeof kvCacheParam.currentValue !== "string") {
    return;
  }

  const nextKvCacheType = kvCacheParam.currentValue;
  if (nextKvCacheType === activeOverride) {
    return;
  }

  try {
    await restartOllamaService(nextKvCacheType);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InvalidModeError([
      `Failed to restart Ollama with kv_cache_type='${nextKvCacheType}': ${detail}`,
    ]);
  }

  hive.configure({ ollamaKvCacheType: nextKvCacheType });
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
