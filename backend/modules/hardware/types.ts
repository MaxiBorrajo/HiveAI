export interface GpuInfo {
  usable: boolean;
  name?: string;
  vramBytes?: number;
  /** Apple Silicon style: the GPU shares system RAM */
  unifiedMemory: boolean;
}

export interface HardwareProfile {
  totalMemBytes: number;
  availableMemBytes: number;
  gpu: GpuInfo;
}

export type FitStatus = "fits" | "slow" | "no_fit";

export interface FitResult {
  status: FitStatus;
  reason: string;
  /** Estimated memory needed: weights + KV cache + runtime overhead */
  requiredBytes: number;
  /** Context left for the conversation once the active plugins' tool definitions are loaded */
  usableContext: number;
}

export type KvCacheType = "f16" | "q8_0" | "q4_0";

export interface FitInput {
  sizeBytes: number;
  /** Parameters in billions; null when unknown */
  paramsBillions: number | null;
  /** Context window the model was trained for; null when unknown */
  contextLength: number | null;
}

export interface FitContext {
  /** Context window the user configured (`n_ctx`) */
  nCtx: number;
  /** Estimated tokens taken by the active plugins' tool definitions */
  pluginTokens: number;
  kvCacheType: KvCacheType;
}
