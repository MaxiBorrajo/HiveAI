import type { CloudProvider } from "../../../core/ai/providers/types.ts";
import type { ApiKeyRow } from "../../../infrastructure/db/schema/index.ts";
import type { ApiKeyDto } from "../types.ts";

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
