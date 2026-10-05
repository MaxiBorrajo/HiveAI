import { AppError } from "../../core/api/errors.ts";
import { validateApiKey } from "../../core/ai/providers/validate-key.ts";
import {
  CLOUD_PROVIDERS,
  type CloudProvider,
  isCloudProvider,
} from "../../core/ai/providers/types.ts";
import type { SecretStore } from "../../core/secrets/secret-store.ts";
import type { ApiKeyRepository } from "../../infrastructure/db/repositories/api-key-repository.ts";
import type { ApiKeyRow } from "../../infrastructure/db/schema/index.ts";

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

export class ApiKeyInUseError extends AppError {
  constructor(public readonly usage: ApiKeyUsage) {
    super(
      "This API key is in use. Deleting it will stop the models that depend on it until you pick another key.",
      409,
    );
  }
}

export function toDto(row: ApiKeyRow): ApiKeyDto {
  return {
    id: row.id,
    provider: row.provider as CloudProvider,
    alias: row.alias,
    masked: `••••${row.last4}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function isUsed(usage: ApiKeyUsage): boolean {
  return usage.chat || usage.executions.length > 0;
}

export class ApiKeyService {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly secrets: SecretStore,
    private readonly findUsage: ApiKeyUsageFinder,
    private readonly validate: typeof validateApiKey = validateApiKey,
  ) {}

  async list(): Promise<ApiKeyDto[]> {
    return (await this.repo.findAll()).map(toDto);
  }

  private async assertAliasFree(
    provider: string,
    alias: string,
    exceptId?: string,
  ) {
    const clash = (await this.repo.findAll()).find(
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

  private cleanAlias(alias: unknown): string {
    const value = typeof alias === "string" ? alias.trim() : "";
    if (!value) throw new AppError("An alias is required.", 400);
    if (value.length > 60) throw new AppError("Alias is too long.", 400);
    return value;
  }

  private cleanValue(value: unknown): string {
    const key = typeof value === "string" ? value.trim() : "";
    if (!key) throw new AppError("The API key value is required.", 400);
    return key;
  }

  async create(input: {
    provider?: unknown;
    alias?: unknown;
    value?: unknown;
  }): Promise<ApiKeyDto> {
    if (!isCloudProvider(input.provider)) {
      throw new AppError(
        `Provider must be one of: ${CLOUD_PROVIDERS.join(", ")}.`,
        400,
      );
    }
    const alias = this.cleanAlias(input.alias);
    const value = this.cleanValue(input.value);
    await this.assertAliasFree(input.provider, alias);
    await this.validateOrThrow(input.provider, value);

    const id = crypto.randomUUID();
    await this.secrets.put(id, value);
    const now = Date.now();
    try {
      const row = await this.repo.create({
        id,
        provider: input.provider,
        alias,
        last4: value.slice(-4),
        createdAt: now,
        updatedAt: now,
      });
      return toDto(row);
    } catch (error) {
      await this.secrets.delete(id);
      throw error;
    }
  }

  async update(
    id: string,
    input: { alias?: unknown; value?: unknown },
  ): Promise<ApiKeyDto> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new AppError("API key not found.", 404);

    const patch: { alias?: string; last4?: string } = {};
    if (input.alias !== undefined) {
      patch.alias = this.cleanAlias(input.alias);
      await this.assertAliasFree(existing.provider, patch.alias, id);
    }
    if (input.value !== undefined) {
      const value = this.cleanValue(input.value);
      await this.validateOrThrow(existing.provider as CloudProvider, value);
      await this.secrets.put(id, value);
      patch.last4 = value.slice(-4);
    }
    await this.repo.update(id, patch);
    return toDto((await this.repo.findById(id))!);
  }

  async getUsage(id: string): Promise<ApiKeyUsage> {
    if (!(await this.repo.findById(id))) {
      throw new AppError("API key not found.", 404);
    }
    return this.findUsage(id);
  }

  async remove(id: string, force = false): Promise<void> {
    const usage = await this.getUsage(id);
    if (isUsed(usage) && !force) throw new ApiKeyInUseError(usage);
    await this.secrets.delete(id);
    await this.repo.delete(id);
  }

  private async validateOrThrow(provider: CloudProvider, value: string) {
    try {
      await this.validate(provider, value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = (error as { kind?: string }).kind;
      throw new AppError(message, kind === "invalid_key" ? 422 : 502);
    }
  }
}
