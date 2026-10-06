import type { ProviderAdapter } from "./adapter.ts";
import { anthropicAdapter } from "./adapters/anthropic.ts";
import { googleAdapter } from "./adapters/google.ts";
import type { CloudProvider } from "./types.ts";

const ADAPTERS: Record<CloudProvider, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  google: googleAdapter,
};

export function getAdapter(provider: CloudProvider): ProviderAdapter {
  return ADAPTERS[provider];
}
