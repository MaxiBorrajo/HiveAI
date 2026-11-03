import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { readModelSettings } from "../../model-settings/lib/settings-store.ts";
import { getPluginContextCost } from "../lib/plugin-context-cost.ts";
import type { FitContext, KvCacheType } from "../types.ts";

const KV_TYPES: KvCacheType[] = ["f16", "q8_0", "q4_0"];
const DEFAULT_N_CTX = 8192;

export interface FitContextDetails {
  context: FitContext;
  plugins: { name: string; tokens: number }[];
}

export async function getFitContext(
  hive: HiveMicrokernel,
): Promise<FitContextDetails> {
  const settings = await readModelSettings();
  const value = (name: string) =>
    settings.find((s) => s.name === name)?.currentValue;
  const nCtx = Number(value("n_ctx"));
  const kv = value("kv_cache_type") as KvCacheType;
  const cost = getPluginContextCost(hive);
  return {
    context: {
      nCtx: Number.isFinite(nCtx) && nCtx > 0 ? nCtx : DEFAULT_N_CTX,
      pluginTokens: cost.tokens,
      kvCacheType: KV_TYPES.includes(kv) ? kv : "f16",
    },
    plugins: cost.plugins,
  };
}
