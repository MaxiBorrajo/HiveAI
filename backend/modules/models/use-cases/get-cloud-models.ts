import {
  listCloudModels,
  type CloudModel,
} from "../../../core/ai/providers/list-cloud-models.ts";
import type { CloudProvider } from "../../../core/ai/providers/types.ts";
import { normalizeProviderError } from "../../../core/ai/providers/errors.ts";
import { getSecretStore } from "../../../core/secrets/index.ts";
import { getORM } from "../../../infrastructure/db/orm.ts";
import { ApiKeyRepository } from "../../../infrastructure/db/repositories/api-key-repository.ts";

export interface CloudModelGroup {
  keyId: string;
  alias: string;
  provider: CloudProvider;
  models: CloudModel[];
  error?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; group: CloudModelGroup }>();

export function invalidateCloudModelsCache(keyId?: string): void {
  if (keyId) cache.delete(keyId);
  else cache.clear();
}

export async function fetchCloudModelGroups(): Promise<CloudModelGroup[]> {
  const keys = await new ApiKeyRepository(getORM()).findAll();
  const secrets = getSecretStore();

  return await Promise.all(
    keys.map(async (key): Promise<CloudModelGroup> => {
      const cached = cache.get(key.id);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return { ...cached.group, alias: key.alias };
      }

      const provider = key.provider as CloudProvider;
      const base = { keyId: key.id, alias: key.alias, provider };
      const value = await secrets.get(key.id);
      if (!value) {
        return {
          ...base,
          models: [],
          error: "The stored API key value is missing. Replace the key.",
        };
      }
      try {
        const group = { ...base, models: await listCloudModels(provider, value) };
        cache.set(key.id, { at: Date.now(), group });
        return group;
      } catch (error) {
        return {
          ...base,
          models: [],
          error: normalizeProviderError(error, provider).message,
        };
      }
    }),
  );
}
