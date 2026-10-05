import { ProviderError } from "./errors.ts";
import { type CloudProvider, OLLAMA_CLOUD_URL } from "./types.ts";

type FetchLike = typeof fetch;

function request(
  provider: CloudProvider,
  apiKey: string,
): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models?limit=1",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/models",
        headers: { Authorization: `Bearer ${apiKey}` },
      };
    case "google":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        headers: { "x-goog-api-key": apiKey },
      };
    case "ollama-cloud":
      return {
        url: `${OLLAMA_CLOUD_URL}/api/tags`,
        headers: { Authorization: `Bearer ${apiKey}` },
      };
  }
}

/** Minimal call to the provider. Throws ProviderError if the key is not usable. */
export async function validateApiKey(
  provider: CloudProvider,
  apiKey: string,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const { url, headers } = request(provider, apiKey);
  let res: Response;
  try {
    res = await fetchFn(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ProviderError(
      "network",
      "Could not reach the provider to validate the key. Check your connection.",
      provider,
    );
  }
  await res.body?.cancel();

  if (res.ok) return;
  if (res.status === 401 || res.status === 403 || res.status === 400) {
    throw new ProviderError(
      "invalid_key",
      "The provider rejected this API key.",
      provider,
    );
  }
  if (res.status === 429) {
    throw new ProviderError(
      "rate_limit",
      "The provider rate-limited the validation request. Try again shortly.",
      provider,
    );
  }
  throw new ProviderError(
    "unknown",
    `The provider returned HTTP ${res.status} while validating the key.`,
    provider,
  );
}
