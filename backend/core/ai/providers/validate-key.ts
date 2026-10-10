import { getAdapter } from "./registry.ts";
import type { CloudProvider } from "./types.ts";

export function validateApiKey(
  provider: CloudProvider,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  return getAdapter(provider).validateKey(apiKey, fetchFn);
}
