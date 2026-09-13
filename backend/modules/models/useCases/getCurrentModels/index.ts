import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { CurrentModels } from "../../types.ts";

export function fetchCurrentModels(hive: HiveMicrokernel): CurrentModels {
  const config = hive.getConfig();

  return {
    model: config.get("model"),
  };
}

export function getCurrentModels(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Response {
  return ResponseBuilder.success(fetchCurrentModels(hive), { headers });
}
