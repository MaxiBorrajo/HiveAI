import { AsyncLocalStorage } from "node:async_hooks";
import type {
  UsageContextKind,
  UsageRole,
} from "../../../infrastructure/db/schema/model_usage.ts";

// Ambient context of the model calls made inside `withUsageContext`. Entry
// points (chat message, execution run, graph generation) open it once, so no
// node or call site has to pass it along.
export interface UsageContext {
  kind: UsageContextKind;
  // Groups every call made for one chat message, one run or one generation.
  groupId: string;
  // "orchestrator" for the model designing something (chat, graph generation),
  // "delegate" for the work delegated to nodes when a graph runs.
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
