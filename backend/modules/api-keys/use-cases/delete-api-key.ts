import { AppError } from "../../../core/api/errors.ts";
import type { ApiKeyDeps, ApiKeyUsage } from "../types.ts";
import { getApiKeyUsage } from "./get-api-key-usage.ts";

export class ApiKeyInUseError extends AppError {
  constructor(public readonly usage: ApiKeyUsage) {
    super(
      "This API key is in use. Deleting it will stop the models that depend on it until you pick another key.",
      409,
    );
  }
}

function isUsed(usage: ApiKeyUsage): boolean {
  return usage.chat || usage.executions.length > 0;
}

export async function deleteApiKey(
  deps: ApiKeyDeps,
  id: string,
  force = false,
): Promise<void> {
  const usage = await getApiKeyUsage(deps, id);
  if (isUsed(usage) && !force) throw new ApiKeyInUseError(usage);
  await deps.secrets.delete(id);
  await deps.repo.delete(id);
}
