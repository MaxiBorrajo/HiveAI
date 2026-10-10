export const CLOUD_PROVIDERS = ["anthropic", "google"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export type ModelProvider = "ollama" | CloudProvider;

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  ollama: "Local (Ollama)",
  anthropic: "Anthropic",
  google: "Google Gemini",
};

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
