import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { parseJsonBody } from "../../../../core/api/request.ts";
import { fetchAvailableModels } from "../getModels/index.ts";
import { fetchCurrentModels } from "../getCurrentModels/index.ts";
import { setCurrentMode } from "../../../modes/useCases/setCurrentMode/index.ts";
import {
  clearKvCacheOverride,
  InvalidModeError,
} from "../../../modes/useCases/setMode/index.ts";
import { CurrentModels } from "../../types.ts";

const DEFAULT_MODE = "default";

interface SetModelsBody {
  model?: string;
}

export class InvalidModelsError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(", "));
  }
}

export async function updateModels(
  hive: HiveMicrokernel,
  patch: SetModelsBody,
): Promise<CurrentModels> {
  const { model } = patch;

  if (!model) {
    throw new InvalidModelsError(["'model' must be provided"]);
  }

  const availableModels = await fetchAvailableModels();
  const availableNames = new Set(availableModels.map((m) => m.name));

  const errors: string[] = [];
  if (!availableNames.has(model)) {
    errors.push(`Model '${model}' is not available`);
  }

  if (errors.length > 0) {
    throw new InvalidModelsError(errors);
  }

  hive.configure({ model });
  await clearKvCacheOverride(hive);
  setCurrentMode(hive, DEFAULT_MODE);

  return fetchCurrentModels(hive);
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
