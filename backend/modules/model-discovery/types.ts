import type { FitResult } from "../hardware/types.ts";

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
}

/** Where a model was found. Ollama's own library is guaranteed to run on Ollama, Hugging Face is not. */
export type ModelSource = "ollama" | "huggingface";

export const MODEL_SOURCES: readonly ModelSource[] = ["ollama", "huggingface"];

export interface ModelCard {
  source: ModelSource;
  /** Library name ("qwen3") or Hugging Face repo ("unsloth/Qwen3-8B-GGUF") */
  id: string;
  /** Name Ollama pulls it by, without a quantization tag */
  ollamaName: string;
  /** Library models only: every parameter count (in billions) the model is published in */
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
  /** defaults to the Ollama library */
  source?: ModelSource;
  sort?: SearchSort;
  cursor?: string;
  filters?: SearchFilters;
}

export interface SearchResult {
  items: SearchResultItem[];
  /** cursor to request the next page with, null when the results are exhausted */
  nextCursor: string | null;
  /** true when the source could not be reached and curated models are shown instead */
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
