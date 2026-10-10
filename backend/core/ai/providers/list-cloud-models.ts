import type { CloudModel } from "./adapter.ts";
import { getAdapter } from "./registry.ts";
import type { CloudProvider } from "./types.ts";

export type { CloudModel };

export function listCloudModels(
  provider: CloudProvider,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<CloudModel[]> {
  return getAdapter(provider).listModels(apiKey, fetchFn);
}
