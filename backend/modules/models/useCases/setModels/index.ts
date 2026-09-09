import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
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
  selectorModel?: string;
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
  const { model, selectorModel } = patch;

  if (!model && !selectorModel) {
    throw new InvalidModelsError([
      "At least one of 'model' or 'selectorModel' must be provided",
    ]);
  }

  const availableModels = await fetchAvailableModels();
  const availableNames = new Set(availableModels.map((m) => m.name));

  const errors: string[] = [];
  if (model && !availableNames.has(model)) {
    errors.push(`Model '${model}' is not available`);
  }
  if (selectorModel && !availableNames.has(selectorModel)) {
    errors.push(`Model '${selectorModel}' is not available`);
  }

  if (errors.length > 0) {
    throw new InvalidModelsError(errors);
  }

  hive.configure({
    ...(model && { model }),
    ...(selectorModel && { selectorModel }),
  });

  if (model) {
    await clearKvCacheOverride(hive);
    setCurrentMode(hive, DEFAULT_MODE);
  }

  return fetchCurrentModels(hive);
}

export async function setModels(
  hive: HiveMicrokernel,
  request: Request,
  headers: Record<string, string>,
): Promise<Response> {
  let body: SetModelsBody;
  try {
    body = await request.json();
  } catch {
    return ResponseBuilder.error(["Invalid JSON body"], undefined, {
      headers,
      status: 400,
    });
  }

  try {
    const current = await updateModels(hive, body);
    return ResponseBuilder.success(current, { headers });
  } catch (error) {
    if (error instanceof InvalidModelsError || error instanceof InvalidModeError) {
      return ResponseBuilder.error(error.errors, undefined, {
        headers,
        status: 400,
      });
    }
    throw error;
  }
}
