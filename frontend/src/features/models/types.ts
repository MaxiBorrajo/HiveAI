export interface ModelInfo {
  name: string;
  architecture: string;
  family: string;
  families: string[];
  format: string;
  parentModel: string;

  sizeBytes: number;
  parameterCount: number;
  parameterSize: string;
  quantizationLevel: string;
  quantizationVersion: number;

  layerCount: number;
  bytesPerLayer: number;

  contextLength: number;
  embeddingLength: number;
  feedForwardLength: number;

  headCount: number;
  headCountKV: number;

  capabilities: string[];

  digest: string;
  modifiedAt: string;
}

export interface ModelFilters {
  name?: string;
  architecture?: string;
  family?: string;
  minSizeBytes?: number;
  maxSizeBytes?: number;
  parameterSize?: string;
  capabilities?: string[];
}

export interface CurrentModels {
  model: string;
  provider: ModelProvider;
  keyId: string;
}

export type ModelProvider =
  | "ollama"
  | "ollama-cloud"
  | "anthropic"
  | "openai"
  | "google";

export interface CloudModel {
  name: string;
  label?: string;
  capabilities: string[];
}

export interface CloudModelGroup {
  keyId: string;
  alias: string;
  provider: Exclude<ModelProvider, "ollama">;
  models: CloudModel[];
  /** Set when the live model list failed and a fallback list is shown. */
  error?: string;
}
