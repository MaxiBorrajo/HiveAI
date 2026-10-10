import { ResponseBuilder } from "../../../core/api/response.ts";
import {
  type ModelOption,
  modelOptionId,
} from "../../../core/ai/providers/model-selection.ts";
import { type ModelProvider, PROVIDER_LABELS } from "../../../core/ai/providers/types.ts";
import { fetchAvailableModels } from "./get-models.ts";
import { fetchCloudModelGroups } from "./get-cloud-models.ts";

export interface ModelOptionGroup {
  id: string;
  label: string;
  provider?: ModelProvider;
  keyAlias?: string;
  error?: string;
  options: ModelOption[];
}

export async function buildModelOptionGroups(): Promise<ModelOptionGroup[]> {
  const groups: ModelOptionGroup[] = [];

  const local = await fetchAvailableModels();
  if (local.length > 0) {
    groups.push({
      id: "local",
      label: PROVIDER_LABELS.ollama,
      provider: "ollama",
      options: local.map((m) => {
        const ref = { provider: "ollama", model: m.name } as const;
        return {
          id: modelOptionId(ref),
          ref,
          label: m.parameterSize ? `${m.parameterSize} local` : "local",
          capabilities: m.capabilities,
          location: "local" as const,
          ...(m.contextLength ? { contextLength: m.contextLength } : {}),
        };
      }),
    });
  }

  for (const g of await fetchCloudModelGroups()) {
    groups.push({
      id: g.keyId,
      label: `${PROVIDER_LABELS[g.provider]} · ${g.alias}`,
      provider: g.provider,
      keyAlias: g.alias,
      error: g.error,
      options: g.models.map((m) => {
        const ref = { provider: g.provider, model: m.name, keyId: g.keyId };
        return {
          id: modelOptionId(ref),
          ref,
          label: m.label ?? "cloud",
          capabilities: m.capabilities,
          location: "cloud" as const,
        };
      }),
    });
  }
  return groups;
}

export async function getModelOptions(
  headers: Record<string, string>,
): Promise<Response> {
  return ResponseBuilder.success(await buildModelOptionGroups(), { headers });
}
