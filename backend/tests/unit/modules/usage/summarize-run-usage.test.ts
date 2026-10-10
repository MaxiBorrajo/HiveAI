import { assertEquals } from "@std/assert";
import type { UsageRecord } from "../../../../infrastructure/db/repositories/model-usage-repository.ts";
import type { RunInfo } from "../../../../modules/usage/run-info.ts";
import {
  designCallsBefore,
  groupByRun,
  summarizeRunUsage,
} from "../../../../modules/usage/summarize-run-usage.ts";

let nextId = 1;

function call(
  overrides: Partial<UsageRecord> = {},
  nodeId: string | null = "n1",
  historyId: number | null = 1,
): UsageRecord {
  return {
    id: nextId++,
    groupId: "g",
    contextKind: "execution",
    provider: "ollama",
    model: "llama3",
    location: "local",
    role: "delegate",
    keyId: null,
    keyAlias: null,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    durationMs: 2_000,
    ttftMs: 500,
    status: "ok",
    errorType: null,
    createdAt: 10_000,
    context: { kind: "execution", executionId: 1, historyId, nodeId },
    ...overrides,
  };
}

function cloud(overrides: Partial<UsageRecord> = {}, nodeId = "n2") {
  return call(
    {
      provider: "anthropic",
      model: "claude-x",
      location: "cloud",
      role: "orchestrator",
      keyId: "k1",
      keyAlias: "work",
      ...overrides,
    },
    nodeId,
  );
}

function info(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    startedAt: 1_000,
    endedAt: 61_000,
    durationMs: 60_000,
    orchestrator: {
      provider: "anthropic",
      model: "claude-x",
      location: "cloud",
      keyId: "k1",
      keyAlias: "work",
      source: "generation",
    },
    nodes: [
      { id: "start", name: "Start", type: "start", model: null },
      {
        id: "n1",
        name: "Summarize",
        type: "llm",
        model: {
          provider: "ollama",
          model: "llama3",
          location: "local",
          keyId: null,
          keyAlias: null,
        },
      },
      {
        id: "n2",
        name: "Review",
        type: "llm",
        model: {
          provider: "anthropic",
          model: "claude-x",
          location: "cloud",
          keyId: "k1",
          keyAlias: "work",
        },
      },
      { id: "n3", name: "Save file", type: "plugin", model: null },
      { id: "end", name: "End", type: "end", model: null },
    ],
    ...overrides,
  };
}

Deno.test("summarizeRunUsage - a run with no record and no calls has no data", () => {
  assertEquals(summarizeRunUsage([], null), null);
});

Deno.test("summarizeRunUsage - a run that made no model calls still reports its run", () => {
  const usage = summarizeRunUsage([], info())!;
  assertEquals(usage.calls, 0);
  assertEquals(usage.latencyMs, 60_000);
  assertEquals(usage.local.inputTokens, null);
  assertEquals(usage.cloud.inputTokens, null);
  assertEquals(usage.delegation.delegatedShare, null);
});

Deno.test("summarizeRunUsage - latency is the run's wall clock, not the sum of calls", () => {
  const usage = summarizeRunUsage(
    [call({ durationMs: 2_000 }), cloud({ durationMs: 3_000 })],
    info({ durationMs: 45_000 }),
  )!;
  assertEquals(usage.latencyMs, 45_000);
});

Deno.test("summarizeRunUsage - without a recorded run, latency falls back to the calls' span", () => {
  const usage = summarizeRunUsage([
    call({ durationMs: 2_000, createdAt: 10_000 }),
    call({ durationMs: 2_000, createdAt: 30_000 }),
  ], null)!;
  assertEquals(usage.latencyMs, 22_000);
});

Deno.test("summarizeRunUsage - local and cloud are separate and nothing is combined", () => {
  const usage = summarizeRunUsage(
    [
      call({ inputTokens: 100, outputTokens: 10 }),
      call({ inputTokens: 200, outputTokens: 20 }),
      cloud({ inputTokens: 1_000, outputTokens: 300 }),
    ],
    info(),
  )!;
  assertEquals(usage.local.inputTokens, 300);
  assertEquals(usage.local.calls, 2);
  assertEquals(usage.cloud.inputTokens, 1_000);
  assertEquals(usage.cloud.outputTokens, 300);
  assertEquals(
    Object.keys(usage).filter((k) => /total/i.test(k)),
    [],
  );
});

Deno.test("summarizeRunUsage - two keys of the same provider stay distinguishable", () => {
  const usage = summarizeRunUsage(
    [
      cloud({ keyId: "k1", keyAlias: "work", inputTokens: 1_000 }),
      cloud({ keyId: "k2", keyAlias: "personal", inputTokens: 500 }),
    ],
    info(),
  )!;
  assertEquals(usage.cloud.models.length, 1);
  assertEquals(usage.cloud.models[0].keyAliases, ["work", "personal"]);
  // Each call keeps its own alias, so a key can be added up against the
  // provider's console.
  const aliases = usage.nodes.find((n) => n.nodeId === "n2")!.calls.map((c) =>
    c.keyAlias
  );
  assertEquals(aliases, ["work", "personal"]);
});

// What designing the graph cost: a generation call, made by the orchestrator.
function design(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return call(
    {
      provider: "anthropic",
      model: "claude-x",
      location: "cloud",
      role: "orchestrator",
      keyId: "k1",
      keyAlias: "work",
      contextKind: "graph_generation",
      context: { kind: "graph_generation", executionId: 1 },
      ...overrides,
    },
    null,
    null,
  );
}

Deno.test("summarizeRunUsage - the same model on two nodes is one row, whatever its role", () => {
  const usage = summarizeRunUsage(
    [cloud({ role: "orchestrator" }), cloud({ role: "delegate" })],
    info(),
  )!;
  assertEquals(usage.cloud.models.length, 1);
  assertEquals(usage.cloud.models[0].calls, 2);
});

Deno.test("summarizeRunUsage - every node of a run is delegated, against what the orchestrator spent designing it", () => {
  // The orchestrator designed the graph: 1,000 tokens. The run's nodes
  // consumed 3,000 (on a local model) and 1,000 (on a cloud model).
  const usage = summarizeRunUsage(
    [
      call({ inputTokens: 2_000, outputTokens: 1_000 }),
      cloud({ inputTokens: 800, outputTokens: 200 }),
    ],
    info(),
    [design({ inputTokens: 700, outputTokens: 300 })],
  )!;
  const d = usage.delegation;
  assertEquals(d.orchestrator, { inputTokens: 700, outputTokens: 300 });
  assertEquals(d.orchestratorCalls, 1);
  assertEquals(d.delegated, { inputTokens: 2_800, outputTokens: 1_200 });
  assertEquals(d.local, { inputTokens: 2_000, outputTokens: 1_000 });
  // 4,000 delegated against 1,000 spent by the orchestrator.
  assertEquals(d.delegatedShare, 0.8);
  // Of the delegated work, 3,000 of 4,000 ran locally.
  assertEquals(d.localShare, 0.75);
});

Deno.test("summarizeRunUsage - a node on the orchestrator's own model is still delegated work", () => {
  const usage = summarizeRunUsage(
    [cloud({ inputTokens: 100, outputTokens: 100 })],
    info(),
    [design({ inputTokens: 100, outputTokens: 100 })],
  )!;
  assertEquals(usage.delegation.delegated, {
    inputTokens: 100,
    outputTokens: 100,
  });
  assertEquals(usage.delegation.delegatedShare, 0.5);
});

Deno.test("summarizeRunUsage - without recorded design calls there is no share, not 0% or 100%", () => {
  const usage = summarizeRunUsage([call()], info(), [])!;
  assertEquals(usage.delegation.orchestrator, {
    inputTokens: null,
    outputTokens: null,
  });
  assertEquals(usage.delegation.orchestratorCalls, 0);
  assertEquals(usage.delegation.delegatedShare, null);
  // Local vs cloud inside the delegated work does not need the orchestrator.
  assertEquals(usage.delegation.localShare, 1);
});

Deno.test("summarizeRunUsage - no reported tokens means no shares", () => {
  const usage = summarizeRunUsage(
    [call({ inputTokens: null, outputTokens: null })],
    info(),
    [design()],
  )!;
  assertEquals(usage.delegation.delegatedShare, null);
  assertEquals(usage.delegation.localShare, null);
});

Deno.test("designCallsBefore - only generation calls made up to the run's start", () => {
  const calls = [
    design({ createdAt: 5_000 }),
    design({ createdAt: 9_000 }),
    design({ createdAt: 20_000 }),
    call({ createdAt: 1_000 }),
  ];
  assertEquals(designCallsBefore(calls, 10_000).length, 2);
});

Deno.test("summarizeRunUsage - per node: graph order, resolved model, model nodes kept, others only with calls", () => {
  const usage = summarizeRunUsage([cloud()], info())!;
  assertEquals(
    usage.nodes.map((n) => n.nodeName),
    ["Summarize", "Review"],
  );
  // The node that made no call still shows the model it was resolved to.
  const summarize = usage.nodes[0];
  assertEquals(summarize.calls.length, 0);
  assertEquals(summarize.configuredModel?.model, "llama3");
  // "Save file" is a plugin node with no calls: not listed.
});

Deno.test("summarizeRunUsage - calls with no node go to their own group", () => {
  const usage = summarizeRunUsage([call({}, null), call({}, "ghost")], info())!;
  const names = usage.nodes.map((n) => n.nodeName);
  assertEquals(names.includes("ghost"), true);
  assertEquals(names[names.length - 1], "Unattributed");
});

Deno.test("summarizeRunUsage - failed calls are visible per node with their error", () => {
  const usage = summarizeRunUsage(
    [
      cloud({
        status: "error",
        errorType: "rate_limit",
        inputTokens: null,
        outputTokens: null,
      }),
      cloud({ inputTokens: 10, outputTokens: 5 }),
    ],
    info(),
  )!;
  assertEquals(usage.failedCalls, 1);
  const review = usage.nodes.find((n) => n.nodeId === "n2")!;
  assertEquals(review.failedCalls, 1);
  assertEquals(review.calls.map((c) => c.errorType).sort(), [null, "rate_limit"]);
  assertEquals(usage.cloud.failedCalls, 1);
});

Deno.test("groupByRun - groups by run and leaves out calls of runs that never finished", () => {
  const grouped = groupByRun([
    call({}, "n1", 7),
    call({}, "n1", 7),
    call({}, "n1", 8),
    call({}, "n1", null),
    call({ context: { kind: "other" } }),
  ]);
  assertEquals(grouped.get(7)?.length, 2);
  assertEquals(grouped.get(8)?.length, 1);
  assertEquals(grouped.size, 2);
});
