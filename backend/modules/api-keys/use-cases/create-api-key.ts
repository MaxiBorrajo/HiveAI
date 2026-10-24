import { AppError } from "../../../core/api/errors.ts";
import {
  CLOUD_PROVIDERS,
  isCloudProvider,
} from "../../../core/ai/providers/types.ts";
import { toDto } from "../lib/api-key-dto.ts";
import {
  assertAliasFree,
  cleanAlias,
  cleanValue,
} from "../lib/clean-input.ts";
import { validateOrThrow } from "../lib/validate-or-throw.ts";
import type { ApiKeyDeps, ApiKeyDto } from "../types.ts";

export async function createApiKey(
  deps: ApiKeyDeps,
  input: { provider?: unknown; alias?: unknown; value?: unknown },
): Promise<ApiKeyDto> {
  if (!isCloudProvider(input.provider)) {
    throw new AppError(
      `Provider must be one of: ${CLOUD_PROVIDERS.join(", ")}.`,
      400,
    );
  }
  const alias = cleanAlias(input.alias);
  const value = cleanValue(input.value);
  await assertAliasFree(deps.repo, input.provider, alias);
  await validateOrThrow(deps, input.provider, value);

  const id = crypto.randomUUID();
  await deps.secrets.put(id, value);
  const now = Date.now();
  try {
    const row = await deps.repo.create({
      id,
      provider: input.provider,
      alias,
      last4: value.slice(-4),
      createdAt: now,
      updatedAt: now,
    });
    return toDto(row);
  } catch (error) {
    await deps.secrets.delete(id);
    throw error;
  }
}
