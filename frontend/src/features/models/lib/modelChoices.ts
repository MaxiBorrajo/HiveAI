import type {
  CurrentModels,
  ModelOption,
  ModelProvider,
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
