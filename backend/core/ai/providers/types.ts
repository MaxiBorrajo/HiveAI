export const CLOUD_PROVIDERS = [
  "ollama-cloud",
  "anthropic",
  "openai",
  "google",
] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export type ModelProvider = "ollama" | CloudProvider;

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  ollama: "Local (Ollama)",
  "ollama-cloud": "Ollama Cloud",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
};

export const OLLAMA_CLOUD_URL = "https://ollama.com";

/** Serializable reference to a model; stored in settings and node configs. */
export interface ModelRef {
  provider: ModelProvider;
  model: string;
  keyId?: string;
}

export function isCloudProvider(value: unknown): value is CloudProvider {
  return (CLOUD_PROVIDERS as readonly unknown[]).includes(value);
}

export function isModelProvider(value: unknown): value is ModelProvider {
  return value === "ollama" || isCloudProvider(value);
}

export function isCloudRef(ref: ModelRef): boolean {
  return isCloudProvider(ref.provider);
}

/**
 * Builds a ModelRef from a bare model name (legacy: always local Ollama) or
 * from an object-like value with provider/model/keyId.
 */
export function normalizeModelRef(
  value: unknown,
  extra?: { provider?: unknown; keyId?: unknown },
): ModelRef {
  if (typeof value === "string") {
    return {
      provider: isModelProvider(extra?.provider) ? extra!.provider : "ollama",
      model: value,
      ...(typeof extra?.keyId === "string" && extra.keyId
        ? { keyId: extra.keyId }
        : {}),
    };
  }
  const obj = (value ?? {}) as Record<string, unknown>;
  const model = String(obj.model ?? obj.name ?? obj.value ?? "");
  const provider = isModelProvider(obj.provider) ? obj.provider : "ollama";
  const keyId = typeof obj.keyId === "string" && obj.keyId ? obj.keyId : undefined;
  return { provider, model, ...(keyId ? { keyId } : {}) };
}
