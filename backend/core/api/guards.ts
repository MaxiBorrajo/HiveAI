import type { HiveMicrokernel } from "../microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "./response.ts";

// Returns an error Response if no model/selectorModel is configured yet,
// or null when the caller is clear to proceed. Use as an early guard in
// routes that need a real model loaded (chat, mode changes, plugin tests).
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
