import type { KvCacheType } from "../types.ts";

const KV_TYPE_FACTOR: Record<KvCacheType, number> = {
  f16: 1,
  q8_0: 0.5,
  q4_0: 0.25,
};

/** Runtime buffers and the compute graph, on top of weights and KV cache. */
export const RUNTIME_OVERHEAD_BYTES = 600 * 1024 * 1024;

/**
 * f16 KV-cache bytes per token, estimated from parameter count.
 * Fitted on common GQA models (Qwen3 0.6B–32B, Llama 3.2 3B): ~115 KB/token at
 * 0.6B, ~147 KB at 8B, ~260 KB at 32B. An estimate, not the exact layer math.
 */
export function kvBytesPerToken(
  paramsBillions: number | null,
  kvCacheType: KvCacheType,
): number {
  const params = paramsBillions ?? 8;
  return (90_000 + 5_000 * params) * KV_TYPE_FACTOR[kvCacheType];
}
