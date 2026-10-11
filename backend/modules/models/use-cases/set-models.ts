import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { parseJsonBody } from "../../../core/api/request.ts";
import { fetchAvailableModels } from "./get-models.ts";
import { fetchCurrentModelsWithSupport } from "./get-current-models.ts";
import { resolveToolSupport } from "./resolve-tool-support.ts";
import { ollamaToolSupport } from "../../../core/ai/providers/tool-support.ts";
import { setCurrentMode } from "../../modes/use-cases/set-current-mode.ts";
import {
  clearKvCacheOverride,
  InvalidModeError,
} from "../../modes/use-cases/set-mode.ts";
import { isModelProvider } from "../../../core/ai/providers/types.ts";
import { getORM } from "../../../infrastructure/db/orm.ts";
import { ApiKeyRepository } from "../../../infrastructure/db/repositories/api-key-repository.ts";
import { CurrentModels } from "../types.ts";

const DEFAULT_MODE = "default";

interface SetModelsBody {
  model?: string;
  provider?: string;
  keyId?: string;
}

export class InvalidModelsError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(", "));
  }
}

function unsupportedMessage(model: string, reason?: string): string {
  return `Model '${model}' cannot be used: ${reason ?? "it does not support tool calling."}`;
}

export async function updateModels(
  hive: HiveMicrokernel,
  patch: SetModelsBody,
): Promise<CurrentModels> {
  const { model } = patch;

  if (!model) {
    throw new InvalidModelsError(["'model' must be provided"]);
  }

  const provider = patch.provider ?? "ollama";
  if (!isModelProvider(provider)) {
    throw new InvalidModelsError([`Unknown provider '${provider}'`]);
  }

  if (provider !== "ollama") {
    const key = patch.keyId
      ? await new ApiKeyRepository(getORM()).findById(patch.keyId)
      : undefined;
    if (!key || key.provider !== provider) {
      throw new InvalidModelsError([
        `Select a valid ${provider} API key for model '${model}'`,
      ]);
    }
    const support = await resolveToolSupport({
      provider,
      model,
      keyId: key.id,
    });
    if (support.status === "unsupported") {
      throw new InvalidModelsError([unsupportedMessage(model, support.reason)]);
    }
    hive.configure({ model, modelProvider: provider, modelKeyId: key.id });
    return fetchCurrentModelsWithSupport(hive);
  }

  const availableModels = await fetchAvailableModels();
  const installed = availableModels.find((m) => m.name === model);

  const errors: string[] = [];
  if (!installed) {
    errors.push(`Model '${model}' is not available`);
  } else {
    const support = ollamaToolSupport(installed.capabilities);
    if (support.status === "unsupported") {
      errors.push(unsupportedMessage(model, support.reason));
    }
  }

  if (errors.length > 0) {
    throw new InvalidModelsError(errors);
  }

  hive.configure({ model, modelProvider: "ollama", modelKeyId: "" });
  await clearKvCacheOverride(hive);
  setCurrentMode(hive, DEFAULT_MODE);

  return fetchCurrentModelsWithSupport(hive);
}

export async function setModels(
  hive: HiveMicrokernel,
  request: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const parsed = await parseJsonBody<SetModelsBody>(request, headers);
  if ("errorResponse" in parsed) return parsed.errorResponse;

  try {
    const current = await updateModels(hive, parsed.body);
    return ResponseBuilder.success(current, { headers });
  } catch (error) {
    if (
      error instanceof InvalidModelsError ||
      error instanceof InvalidModeError
    ) {
      return ResponseBuilder.error(error.errors, undefined, {
        headers,
        status: 400,
      });
    }
    throw error;
  }
}
