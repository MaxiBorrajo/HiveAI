import type { HiveMicrokernel } from "../microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "./response.ts";

export function requireModelsConfigured(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Response | null {
  const config = hive.getConfig();

  if (!config.get("model") || !config.get("selectorModel")) {
    return ResponseBuilder.error(
      [
        "No model is configured. Select a model and a selector model before continuing.",
      ],
      undefined,
      { headers, status: 400 },
    );
  }

  return null;
}
