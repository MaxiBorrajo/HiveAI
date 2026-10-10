import type { UsageRecord } from "../../infrastructure/db/repositories/model-usage-repository.ts";
import type {
  ConversationUsage,
  MessageUsage,
  ModelTotals,
  TokenTotals,
  UsageBucket,
  UsedModel,
} from "./types.ts";

// The call's own start, derived from when it was recorded (at its end).
function startedAt(call: UsageRecord): number {
  return call.createdAt - call.durationMs;
}

// Sum of the reported values, or null when none was reported.
function sumReported(values: (number | null)[]): number | null {
  let total: number | null = null;
  for (const value of values) {
    if (value !== null) total = (total ?? 0) + value;
  }
  return total;
}

function tokenTotals(calls: UsageRecord[]): TokenTotals {
  const ok = calls.filter((c) => c.status === "ok");
  return {
    inputTokens: sumReported(calls.map((c) => c.inputTokens)),
    outputTokens: sumReported(calls.map((c) => c.outputTokens)),
    cacheReadTokens: sumReported(calls.map((c) => c.cacheReadTokens)),
    cacheWriteTokens: sumReported(calls.map((c) => c.cacheWriteTokens)),
    reasoningTokens: sumReported(calls.map((c) => c.reasoningTokens)),
    tokensComplete: ok.every(
      (c) => c.inputTokens !== null && c.outputTokens !== null,
    ),
  };
}

// Output tokens per second of generation. Only calls that reported both their
// output tokens and when the first token arrived can say how long generating
// took; the rest are left out instead of guessed.
function tokensPerSecond(calls: UsageRecord[]): number | null {
  let tokens = 0;
  let generationMs = 0;
  for (const call of calls) {
    if (
      call.status !== "ok" ||
      call.outputTokens === null ||
      call.ttftMs === null
    ) continue;
    const ms = call.durationMs - call.ttftMs;
    if (ms <= 0) continue;
    tokens += call.outputTokens;
    generationMs += ms;
  }
  return generationMs > 0 ? tokens / (generationMs / 1000) : null;
}

function usedModels(calls: UsageRecord[]): UsedModel[] {
  const byKey = new Map<string, UsedModel>();
  for (const call of calls) {
    const key = `${call.provider}\u0000${call.model}`;
    const found = byKey.get(key);
    if (found) found.calls++;
    else {
      byKey.set(key, {
        provider: call.provider,
        model: call.model,
        location: call.location,
        calls: 1,
      });
    }
  }
  return [...byKey.values()];
}

// null when nothing was recorded for the response (messages from before usage
// tracking), so the UI can show "—" instead of zeros.
export function summarizeMessageUsage(
  calls: UsageRecord[],
): MessageUsage | null {
  if (calls.length === 0) return null;

  const ordered = [...calls].sort((a, b) => startedAt(a) - startedAt(b));
  const start = startedAt(ordered[0]);
  const end = Math.max(...calls.map((c) => c.createdAt));

  return {
    ...tokenTotals(calls),
    calls: calls.length,
    failedCalls: calls.filter((c) => c.status === "error").length,
    tokensPerSecond: tokensPerSecond(calls),
    ttftMs: ordered[0].ttftMs,
    latencyMs: end - start,
    models: usedModels(ordered),
  };
}

function modelTotals(calls: UsageRecord[]): ModelTotals[] {
  const groups = new Map<string, UsageRecord[]>();
  for (const call of calls) {
    const key = `${call.provider}\u0000${call.model}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.values()].map((group) => ({
    provider: group[0].provider,
    model: group[0].model,
    keyAliases: [
      ...new Set(
        group.map((c) => c.keyAlias).filter((a): a is string => a !== null),
      ),
    ],
    calls: group.length,
    failedCalls: group.filter((c) => c.status === "error").length,
    tokensPerSecond: tokensPerSecond(group),
    ...tokenTotals(group),
  }));
}

function bucket(calls: UsageRecord[]): UsageBucket {
  return {
    ...tokenTotals(calls),
    calls: calls.length,
    failedCalls: calls.filter((c) => c.status === "error").length,
    models: modelTotals(calls),
  };
}

export function summarizeConversationUsage(
  calls: UsageRecord[],
): ConversationUsage {
  return {
    local: bucket(calls.filter((c) => c.location === "local")),
    cloud: bucket(calls.filter((c) => c.location === "cloud")),
  };
}

// Groups chat calls by the message they produced. Calls not linked to a
// message (a response that was never saved) are left out.
export function groupByMessage(
  calls: UsageRecord[],
): Map<number, UsageRecord[]> {
  const byMessage = new Map<number, UsageRecord[]>();
  for (const call of calls) {
    if (call.context.kind !== "chat" || call.context.messageId === null) {
      continue;
    }
    const id = call.context.messageId;
    byMessage.set(id, [...(byMessage.get(id) ?? []), call]);
  }
  return byMessage;
}
