import type { HiveConfig } from "../../microkernel/hive-settings.ts";
import { type ModelRef, normalizeModelRef } from "./types.ts";

export function getCurrentModelRef(config: HiveConfig): ModelRef {
  return normalizeModelRef(config.get("model"), {
    provider: config.get("modelProvider"),
    keyId: config.get("modelKeyId"),
  });
}
