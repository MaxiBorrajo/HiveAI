import { AppError } from "../../../core/api/errors.ts";
import type { CloudProvider } from "../../../core/ai/providers/types.ts";
import { toDto } from "../lib/api-key-dto.ts";
import {
  assertAliasFree,
  cleanAlias,
  cleanValue,
} from "../lib/clean-input.ts";
import { validateOrThrow } from "../lib/validate-or-throw.ts";
import type { ApiKeyDeps, ApiKeyDto } from "../types.ts";

export async function updateApiKey(
  deps: ApiKeyDeps,
  id: string,
  input: { alias?: unknown; value?: unknown },
): Promise<ApiKeyDto> {
  const existing = await deps.repo.findById(id);
  if (!existing) throw new AppError("API key not found.", 404);

  const patch: { alias?: string; last4?: string } = {};
  if (input.alias !== undefined) {
    patch.alias = cleanAlias(input.alias);
    await assertAliasFree(deps.repo, existing.provider, patch.alias, id);
  }
  if (input.value !== undefined) {
    const value = cleanValue(input.value);
    await validateOrThrow(deps, existing.provider as CloudProvider, value);
    await deps.secrets.put(id, value);
    patch.last4 = value.slice(-4);
  }
  await deps.repo.update(id, patch);
  return toDto((await deps.repo.findById(id))!);
}
