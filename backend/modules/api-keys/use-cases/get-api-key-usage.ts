import { AppError } from "../../../core/api/errors.ts";
import type { ApiKeyDeps, ApiKeyUsage } from "../types.ts";

export async function getApiKeyUsage(
  deps: ApiKeyDeps,
  id: string,
): Promise<ApiKeyUsage> {
  if (!(await deps.repo.findById(id))) {
    throw new AppError("API key not found.", 404);
  }
  return deps.findUsage(id);
}
