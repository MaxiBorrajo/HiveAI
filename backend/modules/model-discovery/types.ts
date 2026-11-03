import type { FitResult } from "../hardware/types.ts";

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
}

export interface ModelCard {
  /** Hugging Face repo, e.g. "unsloth/Qwen3-8B-GGUF" */
  id: string;
  /** Name Ollama pulls it by, without a quantization tag */
  ollamaName: string;
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
  /** Full name to hand to the downloads module, e.g. "hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M" */
  ollamaName: string;
}

export interface SearchResultItem {
  card: ModelCard;
  /** Fit of a Q4_K_M build, estimated from the parameter count (exact sizes come with the detail view) */
  fit: FitResult | null;
  estimatedQ4Bytes: number | null;
}

export type SearchSort = "recommended" | "trending" | "downloads" | "likes" | "updated";

export const SEARCH_SORTS: readonly SearchSort[] = [
  "recommended",
  "trending",
  "downloads",
  "likes",
  "updated",
];

export interface SearchFilters {
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  /** keep only models that fit (or run slowly) on this machine */
  fitsOnly?: boolean;
}

export interface SearchOptions {
  sort?: SearchSort;
  cursor?: string;
  filters?: SearchFilters;
}

export interface SearchResult {
  items: SearchResultItem[];
  /** cursor to request the next page with, null when the results are exhausted */
  nextCursor: string | null;
  /** true when Hugging Face could not be reached and curated models are shown instead */
  offline: boolean;
}

export interface QuantizationFit {
  quant: Quantization;
  fit: FitResult;
}

export interface ModelDetail {
  card: ModelCard;
  readmeSummary: string;
  readme: string;
  quantizations: QuantizationFit[];
  bestQuantization: string | null;
}
