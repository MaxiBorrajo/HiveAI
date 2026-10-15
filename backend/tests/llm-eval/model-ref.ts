import { isCloudProvider, isModelProvider, type ModelRef } from "../../core/ai/providers/types.ts";

/**
 * Parses a CLI model argument of the form "provider:model" (e.g.
 * "anthropic:claude-3-5-sonnet-latest"). If no known provider prefix is
 * found, defaults to "ollama" and treats the whole value as the Ollama model
 * tag (so "qwen3:8b" still works as-is). Cloud providers require a separate
 * `--executor-key`/`--judge-key` flag for the keyId — pass it via `withKeyId`.
 */
export function parseModelArg(raw: string): ModelRef {
  const [maybeProvider, ...rest] = raw.split(":");

  if (isModelProvider(maybeProvider) && isCloudProvider(maybeProvider)) {
    const model = rest.join(":");
    if (!model) {
      throw new Error(`Invalid model ref '${raw}': expected "provider:model".`);
    }
    return { provider: maybeProvider, model };
  }

  return { provider: "ollama", model: raw };
}

export function withKeyId(ref: ModelRef, keyId: string | undefined): ModelRef {
  if (!keyId) return ref;
  return { ...ref, keyId };
}

export function modelRefLabel(ref: ModelRef): string {
  return ref.provider === "ollama" ? ref.model : `${ref.provider}:${ref.model}`;
}

export function modelRefFileSafe(ref: ModelRef): string {
  return modelRefLabel(ref).replaceAll(/[:/\\]/g, "-");
}
