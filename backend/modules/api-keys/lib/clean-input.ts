import { AppError } from "../../../core/api/errors.ts";
import type { ApiKeyRepository } from "../../../infrastructure/db/repositories/api-key-repository.ts";

export function cleanAlias(alias: unknown): string {
  const value = typeof alias === "string" ? alias.trim() : "";
  if (!value) throw new AppError("An alias is required.", 400);
  if (value.length > 60) throw new AppError("Alias is too long.", 400);
  return value;
}

export function cleanValue(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) throw new AppError("The API key value is required.", 400);
  return key;
}

export async function assertAliasFree(
  repo: ApiKeyRepository,
  provider: string,
  alias: string,
  exceptId?: string,
): Promise<void> {
  const clash = (await repo.findAll()).find(
    (k) =>
      k.provider === provider &&
      k.id !== exceptId &&
      k.alias.toLowerCase() === alias.toLowerCase(),
  );
  if (clash) {
    throw new AppError(
      `You already have a ${provider} key named '${alias}'.`,
      409,
    );
  }
}
