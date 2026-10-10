import { AppError } from "../../core/api/errors.ts";
import {
  USAGE_CONTEXT_KINDS,
  USAGE_LOCATIONS,
  USAGE_ROLES,
  USAGE_STATUSES,
} from "../../infrastructure/db/schema/model_usage.ts";
import type { UsageFilters } from "../../infrastructure/db/repositories/model-usage-repository.ts";

export const DEFAULT_USAGE_LIMIT = 100;
export const MAX_USAGE_LIMIT = 500;

function int(query: Record<string, string>, name: string): number | undefined {
  const raw = query[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new AppError(`Invalid ${name}`, 400);
  }
  return value;
}

function oneOf<T extends string>(
  query: Record<string, string>,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const raw = query[name];
  if (raw === undefined || raw === "") return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new AppError(`Invalid ${name}. Use one of: ${allowed.join(", ")}`, 400);
  }
  return raw as T;
}

// Pure so it can be tested without a server: query string in, filters out.
export function parseUsageFilters(query: Record<string, string>): UsageFilters {
  const limit = int(query, "limit") ?? DEFAULT_USAGE_LIMIT;
  const offset = int(query, "offset") ?? 0;
  if (limit < 1 || limit > MAX_USAGE_LIMIT) {
    throw new AppError(`limit must be between 1 and ${MAX_USAGE_LIMIT}`, 400);
  }
  if (offset < 0) throw new AppError("offset must be 0 or more", 400);

  return {
    context: oneOf(query, "context", USAGE_CONTEXT_KINDS),
    chatId: int(query, "chatId"),
    messageId: int(query, "messageId"),
    executionId: int(query, "executionId"),
    historyId: int(query, "historyId"),
    nodeId: query.nodeId || undefined,
    groupId: query.groupId || undefined,
    provider: query.provider || undefined,
    model: query.model || undefined,
    location: oneOf(query, "location", USAGE_LOCATIONS),
    role: oneOf(query, "role", USAGE_ROLES),
    keyId: query.keyId || undefined,
    status: oneOf(query, "status", USAGE_STATUSES),
    from: int(query, "from"),
    to: int(query, "to"),
    limit,
    offset,
  };
}
