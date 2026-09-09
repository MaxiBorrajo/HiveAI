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
  modifiedAt: Date;
}

export interface ModelFilters {
  name?: string;
  architecture?: string;
  family?: string;
  minSizeBytes?: number;
  maxSizeBytes?: number;
  parameterSize?: string;
  capabilities?: string[];
  maxParameterCount?: number;
  minContextLength?: number;
  excludeName?: string;
}

export interface CurrentModels {
  model: string;
  selectorModel: string;
}