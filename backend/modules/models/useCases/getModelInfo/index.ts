import { Ollama } from "ollama";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { ModelInfo } from "../../types.ts";

export async function fetchModelInfo(
  modelName: string,
): Promise<ModelInfo | null> {
  const ollama = new Ollama();

  let models: Awaited<ReturnType<typeof ollama.list>>["models"];
  try {
    ({ models } = await ollama.list());
  } catch {
    return null;
  }

  const modelEntry = models.find((m) => m.name === modelName);

  if (!modelEntry) return null;

  const data = await ollama.show({ model: modelName });
  const modelInfo = data.model_info as unknown as Record<string, unknown>;
  const architecture = modelInfo["general.architecture"] as string;

  const layerCount = modelInfo[`${architecture}.block_count`] as number;
  const sizeBytes = modelEntry.size ?? 0;

  return {
    name: modelName,
    architecture,
    family: data.details.family,
    families: data.details.families ?? [],
    format: data.details.format,
    parentModel: data.details.parent_model,

    sizeBytes,
    parameterCount: modelInfo["general.parameter_count"] as number,
    parameterSize: data.details.parameter_size,
    quantizationLevel: data.details.quantization_level,
    quantizationVersion: modelInfo["general.quantization_version"] as number,

    layerCount,
    bytesPerLayer: layerCount > 0 ? sizeBytes / layerCount : 0,

    contextLength: modelInfo[`${architecture}.context_length`] as number,
    embeddingLength: modelInfo[`${architecture}.embedding_length`] as number,
    feedForwardLength: modelInfo[
      `${architecture}.feed_forward_length`
    ] as number,

    headCount: modelInfo[`${architecture}.attention.head_count`] as number,
    headCountKV: modelInfo[`${architecture}.attention.head_count_kv`] as number,

    capabilities: data.capabilities ?? [],

    digest: modelEntry.digest,
    modifiedAt: modelEntry.modified_at,
  };
}

export async function getModelInfo(
  modelName: string,
  headers: Record<string, string>,
): Promise<Response> {
  const modelInfo = await fetchModelInfo(modelName);

  if (!modelInfo) {
    return ResponseBuilder.error(["Model not found"], undefined, {
      headers,
      status: 404,
    });
  }

  return ResponseBuilder.success(modelInfo, { headers });
}
