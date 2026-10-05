import { PROVIDER_LABELS } from "@/features/api-keys/types";
import type {
  CloudModelGroup,
  CurrentModels,
  ModelInfo,
  ModelProvider,
} from "@/features/models/types";

/** A selectable model: a local model, or a cloud model bound to one key. */
export interface ModelChoice {
  provider: ModelProvider;
  model: string;
  keyId: string;
}

export interface ModelChoiceGroup {
  id: string;
  label: string;
  choices: ModelChoice[];
  error?: string;
}

export function choiceValue(c: Pick<ModelChoice, "provider" | "model" | "keyId">) {
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

/** Local models first, then one group per stored key (e.g. "Anthropic · Claude – work"). */
export function buildChoiceGroups(
  models: ModelInfo[],
  cloud: CloudModelGroup[],
): ModelChoiceGroup[] {
  const groups: ModelChoiceGroup[] = [];
  if (models.length > 0) {
    groups.push({
      id: "local",
      label: "Local (Ollama)",
      choices: models.map((m) => ({
        provider: "ollama",
        model: m.name,
        keyId: "",
      })),
    });
  }
  for (const g of cloud) {
    groups.push({
      id: g.keyId,
      label: `${PROVIDER_LABELS[g.provider]} · ${g.alias}`,
      error: g.error,
      choices: g.models.map((m) => ({
        provider: g.provider,
        model: m.name,
        keyId: g.keyId,
      })),
    });
  }
  return groups;
}

export function isCloud(provider: ModelProvider | undefined) {
  return !!provider && provider !== "ollama";
}
