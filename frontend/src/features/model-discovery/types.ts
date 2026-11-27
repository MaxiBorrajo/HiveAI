export type FitStatus = "fits" | "slow" | "no_fit";

export interface FitResult {
  status: FitStatus;
  reason: string;
  requiredBytes: number;
  usableContext: number;
}

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
}

/** Ollama's own library is guaranteed to run on Ollama; Hugging Face repos are not verified. */
export type ModelSource = "ollama" | "huggingface";

export interface ModelCard {
  source: ModelSource;
  id: string;
  ollamaName: string;
  /** library models: every parameter count (billions) the model is published in */
  sizes?: number[];
  paramsBillions: number | null;
  architecture: string | null;
  contextLength: number | null;
  downloads: number;
  likes: number;
  license: string | null;
  capabilities: ModelCapabilities;
}

export interface Quantization {
  name: string;
  sizeBytes: number;
  ollamaName: string;
}

export interface SearchResultItem {
  card: ModelCard;
  fit: FitResult | null;
  estimatedQ4Bytes: number | null;
}

/** Models a chosen LLM picked from the library for a free-text request. */
export interface SuggestResult {
  items: SearchResultItem[];
  /** One short sentence per model, keyed by `card.id` */
  reasons: Record<string, string>;
  /** Set when nothing matched */
  message?: string;
}

export interface SearchResult {
  items: SearchResultItem[];
  /** cursor for the next page, null when the results are exhausted */
  nextCursor: string | null;
  offline: boolean;
}

export type SearchSort = "recommended" | "trending" | "downloads" | "likes" | "updated";

export interface SearchFilters {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  fitsOnly: boolean;
}

export const NO_FILTERS: SearchFilters = {
  tools: false,
  vision: false,
  reasoning: false,
  fitsOnly: false,
};

export interface SearchParams {
  source: ModelSource;
  q: string;
  sort: SearchSort;
  filters: SearchFilters;
  cursor?: string;
}

export interface ModelDetail {
  card: ModelCard;
  readmeSummary: string;
  readme: string;
  quantizations: { quant: Quantization; fit: FitResult }[];
  bestQuantization: string | null;
}

export interface HardwareReport {
  profile: {
    totalMemBytes: number;
    availableMemBytes: number;
    gpu: {
      usable: boolean;
      name?: string;
      vramBytes?: number;
      unifiedMemory: boolean;
    };
  };
  context: { nCtx: number; pluginTokens: number; kvCacheType: string };
  plugins: { name: string; tokens: number }[];
  noToolModelFits: boolean;
  cloudSuggestion: {
    keyId: string;
    alias: string;
    provider: string;
    model: string;
  } | null;
  hasCloudKey: boolean;
}
