import { toDto } from "../lib/api-key-dto.ts";
import type { ApiKeyDeps, ApiKeyDto } from "../types.ts";

export async function listApiKeys(deps: ApiKeyDeps): Promise<ApiKeyDto[]> {
  return (await deps.repo.findAll()).map(toDto);
}
