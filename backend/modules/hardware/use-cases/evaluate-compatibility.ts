import { formatBytes } from "../lib/format-bytes.ts";
import { kvBytesPerToken, RUNTIME_OVERHEAD_BYTES } from "../lib/estimate-memory.ts";
import type {
  FitContext,
  FitInput,
  FitResult,
  HardwareProfile,
} from "../types.ts";

/** Fraction of free memory we are willing to fill. */
const HEADROOM = 0.9;
/** Below this many weight bytes, CPU inference is still comfortable. */
const COMFORTABLE_CPU_WEIGHTS_BYTES = 3 * 1024 ** 3;
const MIN_USABLE_CONTEXT = 1024;

export function evaluateFit(
  profile: HardwareProfile,
  model: FitInput,
  ctx: FitContext,
): FitResult {
  const effectiveCtx = Math.min(ctx.nCtx, model.contextLength ?? ctx.nCtx);
  const usableContext = Math.max(0, effectiveCtx - ctx.pluginTokens);
  const requiredBytes = model.sizeBytes +
    kvBytesPerToken(model.paramsBillions, ctx.kvCacheType) * effectiveCtx +
    RUNTIME_OVERHEAD_BYTES;
  const result = (status: FitResult["status"], reason: string): FitResult => ({
    status,
    reason,
    requiredBytes,
    usableContext,
  });

  if (usableContext < MIN_USABLE_CONTEXT) {
    return result(
      "no_fit",
      `Active plugins use ~${ctx.pluginTokens} tokens, leaving ${usableContext} of ${effectiveCtx} for the conversation.`,
    );
  }

  const ramBudget = profile.availableMemBytes * HEADROOM;
  const need = formatBytes(requiredBytes);

  if (profile.gpu.usable && profile.gpu.unifiedMemory) {
    return requiredBytes <= ramBudget
      ? result("fits", `Needs ~${need} of ${formatBytes(profile.availableMemBytes)} free unified memory.`)
      : result("no_fit", `Needs ~${need}, only ${formatBytes(profile.availableMemBytes)} of unified memory is free.`);
  }

  if (profile.gpu.usable && profile.gpu.vramBytes) {
    const vramBudget = profile.gpu.vramBytes * HEADROOM;
    if (requiredBytes <= vramBudget) {
      return result("fits", `Needs ~${need}, fits in ${formatBytes(profile.gpu.vramBytes)} of VRAM.`);
    }
    if (requiredBytes <= ramBudget) {
      return result(
        "slow",
        `Needs ~${need}, more than the ${formatBytes(profile.gpu.vramBytes)} of VRAM: part of the model runs on CPU.`,
      );
    }
    return result("no_fit", `Needs ~${need}, only ${formatBytes(profile.availableMemBytes)} of RAM is free.`);
  }

  if (requiredBytes > ramBudget) {
    return result("no_fit", `Needs ~${need}, only ${formatBytes(profile.availableMemBytes)} of RAM is free.`);
  }
  return model.sizeBytes <= COMFORTABLE_CPU_WEIGHTS_BYTES
    ? result("fits", `Needs ~${need}; small enough to run on CPU (no usable GPU).`)
    : result("slow", `Needs ~${need}; fits in RAM but runs on CPU (no usable GPU), so expect slow replies.`);
}

/** Quantizations in the order we would rather recommend them. */
const QUANT_PREFERENCE = [
  "Q4_K_M",
  "Q5_K_M",
  "Q6_K",
  "Q8_0",
  "Q4_K_S",
  "Q4_K_XL",
  "IQ4_XS",
  "Q4_0",
  "Q5_K_S",
  "Q3_K_M",
  "Q3_K_S",
  "IQ3_M",
  "Q2_K",
];

function quantRank(name: string): number {
  const i = QUANT_PREFERENCE.indexOf(name.toUpperCase());
  return i === -1 ? QUANT_PREFERENCE.length : i;
}

export interface QuantFit<Q> {
  quant: Q;
  fit: FitResult;
}

/** Evaluates every quantization and picks the preferred one that fits; else the smallest, to show why not. */
export function evaluateQuants<Q extends { name: string; sizeBytes: number }>(
  profile: HardwareProfile,
  quants: Q[],
  model: Omit<FitInput, "sizeBytes">,
  ctx: FitContext,
): { all: QuantFit<Q>[]; best: QuantFit<Q> | null } {
  const all = quants.map((quant) => ({
    quant,
    fit: evaluateFit(profile, { ...model, sizeBytes: quant.sizeBytes }, ctx),
  }));
  const rank = (s: FitResult["status"]) => (s === "fits" ? 0 : s === "slow" ? 1 : 2);
  // never recommend 1-bit style quants just because they are the only ones that fit
  const recommendable = all.filter((q) => quantRank(q.quant.name) < QUANT_PREFERENCE.length);
  const pool = recommendable.length > 0 ? recommendable : all;
  const best = [...pool].sort((a, b) =>
    rank(a.fit.status) - rank(b.fit.status) ||
    quantRank(a.quant.name) - quantRank(b.quant.name) ||
    a.quant.sizeBytes - b.quant.sizeBytes
  )[0] ?? null;
  const fitting = best && best.fit.status === "no_fit"
    ? [...pool].sort((a, b) => a.quant.sizeBytes - b.quant.sizeBytes)[0]
    : best;
  return { all, best: fitting };
}
