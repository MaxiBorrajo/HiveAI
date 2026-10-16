import ollama from "ollama";
import { isCloudProvider, isModelProvider, type ModelRef } from "../../core/ai/providers/types.ts";
import type { SecretResolver } from "../../core/ai/providers/create-chat-model.ts";

/**
 * Default env var name per cloud provider, used when --executor-key /
 * --judge-key isn't passed explicitly.
 */
const DEFAULT_ENV_VAR: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
};

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

/**
 * Resolves the keyId for a cloud ModelRef: an explicit --executor-key/
 * --judge-key wins; otherwise falls back to the provider's default env var
 * name (e.g. "ANTHROPIC_API_KEY"), used as the "keyId" the env-based
 * SecretResolver below knows how to read. No-op for Ollama.
 */
export function withKeyId(ref: ModelRef, keyId: string | undefined): ModelRef {
  if (ref.provider === "ollama") return ref;
  const resolvedKeyId = keyId ?? DEFAULT_ENV_VAR[ref.provider];
  if (!resolvedKeyId) return ref;
  return { ...ref, keyId: resolvedKeyId };
}

/**
 * A SecretResolver that treats the keyId as the name of an environment
 * variable and reads the secret straight from the eval process's own env —
 * independent of the app's api_keys table / SecretStore, so the eval stays
 * reproducible without requiring anyone to have saved a key via the UI first.
 */
export const envSecretResolver: SecretResolver = (keyId) =>
  Promise.resolve(Deno.env.get(keyId));

export function modelRefLabel(ref: ModelRef): string {
  return ref.provider === "ollama" ? ref.model : `${ref.provider}:${ref.model}`;
}

export function modelRefFileSafe(ref: ModelRef): string {
  return modelRefLabel(ref).replaceAll(/[:/\\]/g, "-");
}

/**
 * Checks whether an Ollama model is pulled locally. Ollama's API lists tags
 * explicitly (e.g. "lfm2.5:latest"), while users typically omit the implicit
 * ":latest" tag on the CLI — so a plain name match is accepted too.
 */
export async function ensureOllamaModelAvailable(model: string): Promise<boolean> {
  try {
    const { models } = await ollama.list();
    return models.some(
      (m) =>
        m.name === model ||
        m.model === model ||
        m.name === `${model}:latest` ||
        m.model === `${model}:latest`,
    );
  } catch {
    return false;
  }
}
