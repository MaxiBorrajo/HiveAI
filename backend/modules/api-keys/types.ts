import type { validateApiKey } from "../../core/ai/providers/validate-key.ts";
import type { CloudProvider } from "../../core/ai/providers/types.ts";
import type { SecretStore } from "../../core/secrets/secret-store.ts";
import type { ApiKeyRepository } from "../../infrastructure/db/repositories/api-key-repository.ts";

export interface ApiKeyDto {
  id: string;
  provider: CloudProvider;
  alias: string;
  masked: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApiKeyUsage {
  executions: { id: number; name: string; nodeIds: string[] }[];
  chat: boolean;
}

export type ApiKeyUsageFinder = (keyId: string) => Promise<ApiKeyUsage>;

export interface ApiKeyDeps {
  repo: ApiKeyRepository;
  secrets: SecretStore;
  findUsage: ApiKeyUsageFinder;
  validate?: typeof validateApiKey;
}
