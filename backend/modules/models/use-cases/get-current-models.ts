import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { CurrentModels } from "../types.ts";
import { resolveToolSupport } from "./resolve-tool-support.ts";
import { getCurrentModelRef } from "../../../core/ai/providers/current-model.ts";

export function fetchCurrentModels(hive: HiveMicrokernel): CurrentModels {
  const config = hive.getConfig();

  return {
    model: config.get("model"),
    provider: config.get("modelProvider"),
    keyId: config.get("modelKeyId"),
  };
}

// The saved model is re-checked on every read: a provider may have changed what
// it supports since the model was chosen.
export async function fetchCurrentModelsWithSupport(
  hive: HiveMicrokernel,
): Promise<CurrentModels> {
  const current = fetchCurrentModels(hive);
  if (!current.model) return current;
  const toolSupport = await resolveToolSupport(
    getCurrentModelRef(hive.getConfig()),
  );
  return { ...current, toolSupport };
}

export async function getCurrentModels(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Promise<Response> {
  return ResponseBuilder.success(await fetchCurrentModelsWithSupport(hive), {
    headers,
  });
}
