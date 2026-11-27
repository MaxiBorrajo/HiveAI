import { getAdapter } from "../providers/registry.ts";
import type { CloudProvider, ModelRef } from "../providers/types.ts";
import type { SecretResolver } from "../providers/create-chat-model.ts";

const SMALL_MODEL_PATTERNS: Record<
  CloudProvider,
  { include: RegExp; exclude: RegExp }
> = {
  anthropic: { include: /haiku/i, exclude: /^$/ },
  google: {
    include: /flash/i,
    exclude: /lite|image|tts|live|audio|thinking|exp|preview-\d|embed/i,
  },
};

const collator = new Intl.Collator("en", { numeric: true });

/** Newest "small" model out of a provider's model ids, or undefined. */
export function pickSmallModel(
  provider: CloudProvider,
  names: string[],
): string | undefined {
  const rule = SMALL_MODEL_PATTERNS[provider];
  if (!rule) return undefined;
  const matches = names
    .map((n) => n.replace(/^models\//, ""))
    .filter((n) => rule.include.test(n) && !rule.exclude.test(n));
  if (matches.length === 0) return undefined;
  return matches.sort(collator.compare).at(-1);
}

const cache = new Map<string, Promise<string | undefined>>();

/**
 * The provider's small model for the same key, discovered from the live model
 * catalog (so no ids are hardcoded). Any failure resolves to undefined and the
 * caller keeps using the current model.
 */
export async function resolveSmallModelRef(
  ref: ModelRef,
  resolveSecret: SecretResolver,
  fetchFn: typeof fetch = fetch,
): Promise<ModelRef | undefined> {
  try {
    if (ref.provider === "ollama" || !ref.keyId) return undefined;
    const provider = ref.provider as CloudProvider;
    const key = `${provider}:${ref.keyId}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = (async () => {
        const apiKey = await resolveSecret(ref.keyId!);
        if (!apiKey) return undefined;
        const models = await getAdapter(provider).listModels(apiKey, fetchFn);
        return pickSmallModel(provider, models.map((m) => m.name));
      })();
      cache.set(key, pending);
      pending.then((v) => {
        if (v === undefined) cache.delete(key);
      }, () => cache.delete(key));
    }
    const model = await pending;
    return model ? { provider: ref.provider, model, keyId: ref.keyId } : undefined;
  } catch {
    return undefined;
  }
}

export function clearSmallModelCache(): void {
  cache.clear();
}
