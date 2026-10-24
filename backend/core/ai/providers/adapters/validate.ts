import { ProviderError } from "../errors.ts";
import type { CloudProvider } from "../types.ts";

export async function validateWithGet(
  provider: CloudProvider,
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<void> {
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
    throw new ProviderError("invalid_key", "The provider rejected this API key.", provider);
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
