import { AsyncLocalStorage } from "node:async_hooks";
import type {
  UsageContextKind,
  UsageRole,
} from "../../../infrastructure/db/schema/model_usage.ts";

export interface UsageContext {
  kind: UsageContextKind;
  groupId: string;
  role: UsageRole;
  chatId?: number;
  executionId?: number;
}

const storage = new AsyncLocalStorage<UsageContext>();

export function withUsageContext<T>(
  context: Omit<UsageContext, "groupId"> & { groupId?: string },
  fn: (groupId: string) => T,
): T {
  const groupId = context.groupId ?? crypto.randomUUID();
  return storage.run({ ...context, groupId }, () => fn(groupId));
}

export function getUsageContext(): UsageContext | undefined {
  return storage.getStore();
}
