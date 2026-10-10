import type { UsageRecord } from "../../infrastructure/db/repositories/model-usage-repository.ts";
import type { RunInfo, RunNodeSnapshot } from "./run-info.ts";
import {
  startedAt,
  sumReported,
  tokensPerSecond,
  tokenTotals,
} from "./summarize-usage.ts";
import type {
  RunBucket,
  RunCall,
  RunDelegation,
  RunModelTotals,
  RunNodeUsage,
  RunUsage,
  TokenPair,
} from "./types.ts";

const UNATTRIBUTED = "Unattributed";

function toRunCall(call: UsageRecord): RunCall {
  return {
    provider: call.provider,
    model: call.model,
    location: call.location,
    keyAlias: call.keyAlias,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    cacheReadTokens: call.cacheReadTokens,
    cacheWriteTokens: call.cacheWriteTokens,
    reasoningTokens: call.reasoningTokens,
    durationMs: call.durationMs,
    ttftMs: call.ttftMs,
    status: call.status,
    errorType: call.errorType,
  };
}

function byStart(a: UsageRecord, b: UsageRecord): number {
  return startedAt(a) - startedAt(b);
}

function modelTotals(calls: UsageRecord[]): RunModelTotals[] {
  const groups = new Map<string, UsageRecord[]>();
  for (const call of calls) {
    const key = `${call.provider}\u0000${call.model}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.values()].map((group) => ({
    provider: group[0].provider,
    model: group[0].model,
    location: group[0].location,
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

function bucket(calls: UsageRecord[]): RunBucket {
  return {
    ...tokenTotals(calls),
    calls: calls.length,
    failedCalls: calls.filter((c) => c.status === "error").length,
    models: modelTotals(calls),
  };
}

function pair(calls: UsageRecord[]): TokenPair {
  return {
    inputTokens: sumReported(calls.map((c) => c.inputTokens)),
    outputTokens: sumReported(calls.map((c) => c.outputTokens)),
  };
}

// Input + output the providers reported, or null when they reported none.
function tokensOf(p: TokenPair): number | null {
  return sumReported([p.inputTokens, p.outputTokens]);
}

function share(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return part / whole;
}

// `designCalls` are the graph-generation calls of the execution made before the
// run: what the orchestrator spent designing it. Every call of the run itself
// is delegated work.
function delegation(
  calls: UsageRecord[],
  designCalls: UsageRecord[],
): RunDelegation {
  const orchestrator = pair(designCalls);
  const delegated = pair(calls);
  const local = pair(calls.filter((c) => c.location === "local"));
  const designed = tokensOf(orchestrator);
  const delegatedTokens = tokensOf(delegated);
  const whole = designed === null || delegatedTokens === null
    ? null
    : designed + delegatedTokens;
  return {
    orchestrator,
    orchestratorCalls: designCalls.length,
    delegated,
    local,
    delegatedShare: share(delegatedTokens, whole),
    localShare: share(tokensOf(local), delegatedTokens),
  };
}

function nodeUsage(
  nodeId: string | null,
  snapshot: RunNodeSnapshot | undefined,
  calls: UsageRecord[],
): RunNodeUsage {
  return {
    nodeId,
    nodeName: snapshot?.name ?? nodeId ?? UNATTRIBUTED,
    nodeType: snapshot?.type ?? null,
    configuredModel: snapshot?.model ?? null,
    calls: [...calls].sort(byStart).map(toRunCall),
    failedCalls: calls.filter((c) => c.status === "error").length,
  };
}

function nodes(calls: UsageRecord[], info: RunInfo | null): RunNodeUsage[] {
  const byNode = new Map<string | null, UsageRecord[]>();
  for (const call of calls) {
    const id = call.context.kind === "execution" ? call.context.nodeId : null;
    byNode.set(id, [...(byNode.get(id) ?? []), call]);
  }

  const result: RunNodeUsage[] = [];
  const seen = new Set<string>();

  // Graph order first. A model node with no calls is kept so its resolved
  // model is still visible; other nodes only appear when they made calls.
  for (const node of info?.nodes ?? []) {
    const nodeCalls = byNode.get(node.id) ?? [];
    seen.add(node.id);
    if (nodeCalls.length === 0 && node.model === null) continue;
    result.push(nodeUsage(node.id, node, nodeCalls));
  }
  for (const [id, nodeCalls] of byNode) {
    if (id !== null && !seen.has(id)) result.push(nodeUsage(id, undefined, nodeCalls));
  }
  const loose = byNode.get(null);
  if (loose) result.push(nodeUsage(null, undefined, loose));
  return result;
}

function wallClock(calls: UsageRecord[]): number | null {
  if (calls.length === 0) return null;
  const start = Math.min(...calls.map(startedAt));
  const end = Math.max(...calls.map((c) => c.createdAt));
  return end - start;
}

// null when nothing is known about the run (it predates usage tracking), so the
// UI can say "No usage data" instead of showing zeros.
export function summarizeRunUsage(
  calls: UsageRecord[],
  info: RunInfo | null,
  designCalls: UsageRecord[] = [],
): RunUsage | null {
  if (!info && calls.length === 0) return null;

  return {
    // The run's own wall clock; the calls' span only when it was not recorded.
    latencyMs: info?.durationMs ?? wallClock(calls),
    calls: calls.length,
    failedCalls: calls.filter((c) => c.status === "error").length,
    orchestrator: info?.orchestrator ?? null,
    local: bucket(calls.filter((c) => c.location === "local")),
    cloud: bucket(calls.filter((c) => c.location === "cloud")),
    delegation: delegation(calls, designCalls),
    nodes: nodes(calls, info),
  };
}

// Groups an execution's calls by the run (history row) they belong to. Calls
// of a run that did not finish are left out: they have no run to show in.
export function groupByRun(calls: UsageRecord[]): Map<number, UsageRecord[]> {
  const byRun = new Map<number, UsageRecord[]>();
  for (const call of calls) {
    if (call.context.kind !== "execution" || call.context.historyId === null) {
      continue;
    }
    const id = call.context.historyId;
    byRun.set(id, [...(byRun.get(id) ?? []), call]);
  }
  return byRun;
}

// The generation calls of an execution made up to a moment (the run's start):
// what the orchestrator spent designing the graph the run executes.
export function designCallsBefore(
  calls: UsageRecord[],
  before: number,
): UsageRecord[] {
  return calls.filter(
    (c) => c.context.kind === "graph_generation" && c.createdAt <= before,
  );
}
