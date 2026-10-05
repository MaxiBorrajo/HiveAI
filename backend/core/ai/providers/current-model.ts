import type { HiveConfig } from "../../microkernel/hive-settings.ts";
import { type ModelRef, normalizeModelRef } from "./types.ts";

/** The model currently selected for chat (and the default for executions). */
export function getCurrentModelRef(config: HiveConfig): ModelRef {
  return normalizeModelRef(config.get("model"), {
    provider: config.get("modelProvider"),
    keyId: config.get("modelKeyId"),
  });
}
