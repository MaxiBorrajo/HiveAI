import type {
  RunCall,
  RunModel,
  RunModelTotals,
  RunNodeUsage,
  RunOrchestrator,
  RunUsage,
  TokenPair,
} from "@/lib/usage";
import type { RunSummary } from "../types";

// Pure comparison of two runs of one execution. There is deliberately no
// combined figure: local and cloud stay apart, and tokens are only set against
// each other when the same model ran in both runs. Tokens are not prices.

export type NodeRowState = "same" | "modelChanged" | "onlyInA" | "onlyInB";

export interface NodeSide {
  nodeId: string | null;
  nodeName: string;
  nodeType: string | null;
  model: RunModel | null;
  tokens: TokenPair;
  // Sum of the node's model calls; null when it made none (plugins, conditions
  // and the like are not timed).
  latencyMs: number | null;
  calls: number;
  failedCalls: number;
}

export interface NodeRow {
  state: NodeRowState;
  // How the two sides were paired; null for nodes without a counterpart.
  matchedBy: "id" | "name" | null;
  a: NodeSide | null;
  b: NodeSide | null;
}

export interface TokenDelta {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
}

export interface ModelRow {
  provider: string;
  model: string;
  a: RunModelTotals | null;
  b: RunModelTotals | null;
  // Present only when the model ran in both runs.
  delta: TokenDelta | null;
  // True when a side did not report every call, so its sums are lower bounds.
  approximate: boolean;
}

export interface HeadlineSide {
  orchestrator: RunOrchestrator | null;
  orchestratorTokens: TokenPair;
  orchestratorCalls: number;
  delegated: TokenPair;
  delegatedLocal: TokenPair;
  delegatedCloud: TokenPair;
  latencyMs: number | null;
  calls: number;
  failedCalls: number;
}

export type RunWarningCode =
  | "noUsage"
  | "differentGraph"
  | "differentInput"
  | "inputNotRecorded"
  | "assumedOrchestrator"
  | "unmatchedNodes";

export interface RunWarning {
  code: RunWarningCode;
  message: string;
}

export interface RunComparison {
  a: HeadlineSide | null;
  b: HeadlineSide | null;
  // Set when both runs used the same orchestrator model, so its tokens can be
  // set against each other.
  orchestratorDelta: TokenDelta | null;
  nodes: NodeRow[];
  nodeCounts: { matched: number; onlyInA: number; onlyInB: number };
  models: ModelRow[];
  warnings: RunWarning[];
}

function sumNullable(values: (number | null)[]): number | null {
  const reported = values.filter((v): v is number => v !== null);
  return reported.length === 0 ? null : reported.reduce((x, y) => x + y, 0);
}

function callTokens(calls: RunCall[]): TokenPair {
  return {
    inputTokens: sumNullable(calls.map((c) => c.inputTokens)),
    outputTokens: sumNullable(calls.map((c) => c.outputTokens)),
  };
}

function toSide(node: RunNodeUsage): NodeSide {
  return {
    nodeId: node.nodeId,
    nodeName: node.nodeName,
    nodeType: node.nodeType,
    model: node.configuredModel,
    tokens: callTokens(node.calls),
    latencyMs:
      node.calls.length === 0
        ? null
        : node.calls.reduce((sum, c) => sum + c.durationMs, 0),
    calls: node.calls.length,
    failedCalls: node.failedCalls,
  };
}

function sameModel(a: RunModel | null, b: RunModel | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.provider === b.provider &&
    a.model === b.model &&
    a.location === b.location &&
    a.keyAlias === b.keyAlias
  );
}

// Pairs the nodes of two runs, each node used once:
//  1. same id and same type (every node, when both used the same graph),
//  2. what is left, by name and type, in order of appearance.
// Whatever stays unpaired is reported as present in only one run.
export function alignNodes(
  nodesA: RunNodeUsage[],
  nodesB: RunNodeUsage[],
): NodeRow[] {
  const pairedB = new Set<number>();
  const pairs: { a: number; b: number | null; by: "id" | "name" | null }[] =
    nodesA.map((_, a) => ({ a, b: null, by: null }));

  const pair = (
    matches: (x: RunNodeUsage, y: RunNodeUsage) => boolean,
    by: "id" | "name",
  ) => {
    for (const p of pairs) {
      if (p.b !== null) continue;
      const found = nodesB.findIndex(
        (y, i) => !pairedB.has(i) && matches(nodesA[p.a], y),
      );
      if (found === -1) continue;
      pairedB.add(found);
      p.b = found;
      p.by = by;
    }
  };

  pair(
    (x, y) =>
      x.nodeId !== null && x.nodeId === y.nodeId && x.nodeType === y.nodeType,
    "id",
  );
  pair(
    (x, y) => x.nodeName === y.nodeName && x.nodeType === y.nodeType,
    "name",
  );

  const rows: NodeRow[] = pairs.map((p) => {
    const a = toSide(nodesA[p.a]);
    if (p.b === null) return { state: "onlyInA", matchedBy: null, a, b: null };
    const b = toSide(nodesB[p.b]);
    return {
      state: sameModel(a.model, b.model) ? "same" : "modelChanged",
      matchedBy: p.by,
      a,
      b,
    };
  });
  nodesB.forEach((node, i) => {
    if (!pairedB.has(i)) {
      rows.push({
        state: "onlyInB",
        matchedBy: null,
        a: null,
        b: toSide(node),
      });
    }
  });
  return rows;
}

function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

function tokenDelta(
  a: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens?: number | null;
  },
  b: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens?: number | null;
  },
): TokenDelta {
  return {
    inputTokens: diff(a.inputTokens, b.inputTokens),
    outputTokens: diff(a.outputTokens, b.outputTokens),
    cacheReadTokens: diff(a.cacheReadTokens ?? null, b.cacheReadTokens ?? null),
  };
}

function modelRows(a: RunUsage, b: RunUsage): ModelRow[] {
  const key = (m: { provider: string; model: string }) =>
    `${m.provider}\u0000${m.model}`;
  const all = (u: RunUsage) => [...u.cloud.models, ...u.local.models];
  const byKeyA = new Map(all(a).map((m) => [key(m), m]));
  const byKeyB = new Map(all(b).map((m) => [key(m), m]));

  const keys = [...new Set([...byKeyA.keys(), ...byKeyB.keys()])];
  return keys.map((k) => {
    const ma = byKeyA.get(k) ?? null;
    const mb = byKeyB.get(k) ?? null;
    const ref = (ma ?? mb)!;
    return {
      provider: ref.provider,
      model: ref.model,
      a: ma,
      b: mb,
      // Only the same model on both sides is set against each other.
      delta: ma && mb ? tokenDelta(ma, mb) : null,
      approximate: !!ma && !!mb && (!ma.tokensComplete || !mb.tokensComplete),
    };
  });
}

function headline(usage: RunUsage): HeadlineSide {
  const { delegation } = usage;
  return {
    orchestrator: usage.orchestrator,
    orchestratorTokens: delegation.orchestrator,
    orchestratorCalls: delegation.orchestratorCalls,
    delegated: delegation.delegated,
    delegatedLocal: delegation.local,
    delegatedCloud: {
      inputTokens: usage.cloud.inputTokens,
      outputTokens: usage.cloud.outputTokens,
    },
    latencyMs: usage.latencyMs,
    calls: usage.calls,
    failedCalls: usage.failedCalls,
  };
}

function sameInput(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const sorted = (o: Record<string, unknown>) =>
    JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return sorted(a) === sorted(b);
}

export function compareRuns(a: RunSummary, b: RunSummary): RunComparison {
  const warnings: RunWarning[] = [];

  if (!a.usage || !b.usage) {
    warnings.push({
      code: "noUsage",
      message:
        "One of the runs has no consumption data (it predates usage tracking), so only its result can be compared.",
    });
  }
  if (a.graphId !== b.graphId) {
    warnings.push({
      code: "differentGraph",
      message:
        "The graph was edited between these runs, so nodes may differ and the orchestrator's design tokens may not be the same work.",
    });
  }
  if (a.input && b.input && !sameInput(a.input, b.input)) {
    warnings.push({
      code: "differentInput",
      message: "The runs were started with different inputs.",
    });
  } else if ((a.input === null) !== (b.input === null)) {
    warnings.push({
      code: "inputNotRecorded",
      message: "The input of one run was not recorded, so it cannot be checked.",
    });
  }
  for (const run of [a, b]) {
    if (run.usage?.orchestrator?.source === "current") {
      warnings.push({
        code: "assumedOrchestrator",
        message: `Run #${run.iteration}: the orchestrator was not recorded, the chat's model at run time is assumed.`,
      });
    }
  }

  const ua = a.usage;
  const ub = b.usage;
  const bothUsage = ua !== null && ub !== null;

  // Without usage on both sides the nodes cannot be paired meaningfully.
  const nodes = bothUsage ? alignNodes(ua.nodes, ub.nodes) : [];
  const nodeCounts = {
    matched: nodes.filter((n) => n.a && n.b).length,
    onlyInA: nodes.filter((n) => n.state === "onlyInA").length,
    onlyInB: nodes.filter((n) => n.state === "onlyInB").length,
  };
  if (nodeCounts.onlyInA + nodeCounts.onlyInB > 0) {
    warnings.push({
      code: "unmatchedNodes",
      message: `${nodeCounts.onlyInA + nodeCounts.onlyInB} node(s) exist in only one run, their figures are shown on their own side.`,
    });
  }

  const orchestratorA = ua?.orchestrator ?? null;
  const orchestratorB = ub?.orchestrator ?? null;
  const sameOrchestrator =
    !!orchestratorA &&
    !!orchestratorB &&
    orchestratorA.provider === orchestratorB.provider &&
    orchestratorA.model === orchestratorB.model;

  return {
    a: ua ? headline(ua) : null,
    b: ub ? headline(ub) : null,
    orchestratorDelta:
      bothUsage && sameOrchestrator
        ? tokenDelta(ua.delegation.orchestrator, ub.delegation.orchestrator)
        : null,
    nodes,
    nodeCounts,
    models: bothUsage ? modelRows(ua, ub) : [],
    warnings,
  };
}
