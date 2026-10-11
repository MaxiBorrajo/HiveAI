import type {
  CurrentModels,
  ModelOption,
  ModelOptionGroup,
  ModelProvider,
  ToolSupport,
} from "@/features/models/types";

export interface ModelChoice {
  provider: ModelProvider;
  model: string;
  keyId: string;
}

export function toChoice(option: ModelOption): ModelChoice {
  return {
    provider: option.ref.provider,
    model: option.ref.model,
    keyId: option.ref.keyId ?? "",
  };
}

export function choiceValue(c: ModelChoice) {
  return JSON.stringify([c.provider, c.keyId, c.model]);
}

export function parseChoiceValue(value: string): ModelChoice | undefined {
  try {
    const [provider, keyId, model] = JSON.parse(value);
    return { provider, keyId, model };
  } catch {
    return undefined;
  }
}

export function sameChoice(a: ModelChoice, b: ModelChoice) {
  return (
    a.provider === b.provider && a.model === b.model && a.keyId === b.keyId
  );
}

export function currentChoice(current: CurrentModels): ModelChoice {
  return {
    provider: current.provider ?? "ollama",
    model: current.model,
    keyId: current.keyId ?? "",
  };
}

export function isCloud(provider: ModelProvider | undefined) {
  return !!provider && provider !== "ollama";
}

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  ollama: "Local (Ollama)",
  anthropic: "Anthropic",
  google: "Google Gemini",
};

export interface KeyRef {
  keyId: string;
  alias: string;
}

export interface ProviderModel {
  model: string;
  keys: KeyRef[];
  toolSupport?: ToolSupport;
}

// Only a confirmed "no" blocks a model; unknown is allowed with a warning.
export function canUse(support: ToolSupport | undefined) {
  return support?.status !== "unsupported";
}

export interface ProviderEntry {
  provider: ModelProvider;
  label: string;
  models: ProviderModel[];
  keyErrors: { alias: string; error: string }[];
}

export function buildProviderTree(
  groups: ModelOptionGroup[],
  { includeUnsupported = false }: { includeUnsupported?: boolean } = {},
): ProviderEntry[] {
  const byProvider = new Map<ModelProvider, ProviderEntry>();

  for (const group of groups) {
    const provider =
      group.provider ??
      group.options[0]?.ref.provider ??
      (group.id === "local" ? "ollama" : undefined);
    if (!provider) continue;

    let entry = byProvider.get(provider);
    if (!entry) {
      entry = {
        provider,
        label: PROVIDER_LABELS[provider],
        models: [],
        keyErrors: [],
      };
      byProvider.set(provider, entry);
    }

    const alias = group.keyAlias ?? group.label;
    if (group.error) entry.keyErrors.push({ alias, error: group.error });

    for (const option of group.options) {
      const keyId = option.ref.keyId ?? "";
      let model = entry.models.find((m) => m.model === option.ref.model);
      if (!model) {
        model = {
          model: option.ref.model,
          keys: [],
          toolSupport: option.toolSupport,
        };
        entry.models.push(model);
      }
      if (keyId && !model.keys.some((k) => k.keyId === keyId)) {
        model.keys.push({ keyId, alias });
      }
    }
  }

  const entries = [...byProvider.values()];
  if (includeUnsupported) return entries;

  // Models that cannot take tools are not offered where one gets chosen.
  for (const entry of entries) {
    entry.models = entry.models.filter((m) => canUse(m.toolSupport));
  }
  return entries.filter((e) => e.models.length > 0 || e.keyErrors.length > 0);
}
