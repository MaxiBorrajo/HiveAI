import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import {
  OllamaRestartError,
  restartOllamaService,
} from "../../../../core/ollama/restartOllamaService.ts";
import { ChatMode } from "../../types.ts";
import { readModesConfig, writeModesConfig } from "../../utils/modesConfig.ts";
import { calculateRuntimeModes } from "../../utils/calculateRuntimeModes.ts";
import { validateModeParameters } from "../../utils/validateModeParameters.ts";
import { setCurrentMode } from "../setCurrentMode/index.ts";

export class InvalidModeError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(", "));
  }
}

async function applyServiceRestartParameters(
  hive: HiveMicrokernel,
  incoming: ChatMode,
  referenceMode: ChatMode,
): Promise<void> {
  const config = hive.getConfig();

  const kvCacheParam = (incoming.parameters ?? []).find(
    (p) => p.name === "kv_cache_type",
  );
  const referenceParam = (referenceMode.parameters ?? []).find(
    (p) => p.name === "kv_cache_type",
  );

  if (
    !kvCacheParam ||
    !referenceParam?.requiresServiceRestart ||
    typeof kvCacheParam.currentValue !== "string"
  ) {
    return;
  }

  const nextKvCacheType = kvCacheParam.currentValue;
  if (nextKvCacheType === config.get("ollamaKvCacheType")) {
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
  let body: ChatMode;
  try {
    body = await request.json();
  } catch {
    return ResponseBuilder.error(["Invalid JSON body"], undefined, {
      headers,
      status: 400,
    });
  }

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
    if (error instanceof InvalidModeError || error instanceof OllamaRestartError) {
      return ResponseBuilder.error(
        error instanceof InvalidModeError ? error.errors : [error.message],
        undefined,
        { headers, status: 400 },
      );
    }
    throw error;
  }
}
