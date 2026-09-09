import { Ollama } from "ollama";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { ModelFilters, ModelInfo } from "../../types.ts";
import { fetchModelInfo } from "../getModelInfo/index.ts";

export async function getModels(
  filters: ModelFilters,
  headers: Record<string, string>,
): Promise<Response> {
  const models = await fetchAvailableModels(filters);

  return ResponseBuilder.success(models, { headers });
}

export async function fetchAvailableModels(
  filters: ModelFilters = {},
): Promise<ModelInfo[]> {
  const ollama = new Ollama();
  const { models } = await ollama.list();

  const modelInfos = (
    await Promise.all(models.map((m) => fetchModelInfo(m.name)))
  ).filter((modelInfo): modelInfo is ModelInfo => modelInfo !== null);

  return modelInfos.filter((model) => matchesFilters(model, filters));
}

function matchesFilters(model: ModelInfo, filters: ModelFilters): boolean {
  if (
    filters.name &&
    !model.name.toLowerCase().includes(filters.name.toLowerCase())
  ) {
    return false;
  }

  if (
    filters.architecture &&
    model.architecture.toLowerCase() !== filters.architecture.toLowerCase()
  ) {
    return false;
  }

  if (
    filters.family &&
    model.family.toLowerCase() !== filters.family.toLowerCase()
  ) {
    return false;
  }

  if (
    filters.minSizeBytes !== undefined &&
    model.sizeBytes < filters.minSizeBytes
  ) {
    return false;
  }

  if (
    filters.maxSizeBytes !== undefined &&
    model.sizeBytes > filters.maxSizeBytes
  ) {
    return false;
  }

  if (
    filters.parameterSize &&
    model.parameterSize.toLowerCase() !== filters.parameterSize.toLowerCase()
  ) {
    return false;
  }

  if (filters.capabilities?.length) {
    const modelCapabilities = model.capabilities.map((c) => c.toLowerCase());
    const requiredCapabilities = filters.capabilities.map((c) =>
      c.toLowerCase(),
    );
    if (!requiredCapabilities.every((c) => modelCapabilities.includes(c))) {
      return false;
    }
  }

  if (filters.excludeName && model.name === filters.excludeName) {
    return false;
  }

  if (
    filters.maxParameterCount !== undefined &&
    model.parameterCount > filters.maxParameterCount
  ) {
    return false;
  }

  if (
    filters.minContextLength !== undefined &&
    model.contextLength < filters.minContextLength
  ) {
    return false;
  }

  return true;
}
