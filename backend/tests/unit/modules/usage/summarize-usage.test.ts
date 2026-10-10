import { assertEquals } from "@std/assert";
import type { UsageRecord } from "../../../../infrastructure/db/repositories/model-usage-repository.ts";
import {
  groupByMessage,
  summarizeConversationUsage,
  summarizeMessageUsage,
} from "../../../../modules/usage/summarize-usage.ts";

let nextId = 1;

// A call that ENDED at `end`, so it started at end - durationMs.
function call(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: nextId++,
    groupId: "g",
    contextKind: "chat",
    provider: "ollama",
    model: "llama3",
    location: "local",
    role: "orchestrator",
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
    context: { kind: "chat", chatId: 1, messageId: 1 },
    ...overrides,
  };
}

Deno.test("summarizeMessageUsage - no calls means no data, not zeros", () => {
  assertEquals(summarizeMessageUsage([]), null);
});

Deno.test("summarizeMessageUsage - sums every internal call of the response", () => {
  const usage = summarizeMessageUsage([
    call({ inputTokens: 100, outputTokens: 20, createdAt: 10_000 }),
    call({ inputTokens: 150, outputTokens: 30, createdAt: 14_000 }),
    call({ inputTokens: 200, outputTokens: 40, createdAt: 18_000 }),
  ])!;
  assertEquals(usage.inputTokens, 450);
  assertEquals(usage.outputTokens, 90);
  assertEquals(usage.calls, 3);
  assertEquals(usage.tokensComplete, true);
});

Deno.test("summarizeMessageUsage - a figure nobody reported stays null, never 0", () => {
  const usage = summarizeMessageUsage([
    call({ cacheReadTokens: null, reasoningTokens: null }),
    call({ cacheReadTokens: null, reasoningTokens: null }),
  ])!;
  assertEquals(usage.cacheReadTokens, null);
  assertEquals(usage.cacheWriteTokens, null);
  assertEquals(usage.reasoningTokens, null);
});

Deno.test("summarizeMessageUsage - cached tokens are summed when reported", () => {
  const usage = summarizeMessageUsage([
    call({ cacheReadTokens: 800, cacheWriteTokens: 100 }),
    call({ cacheReadTokens: 400, cacheWriteTokens: null }),
  ])!;
  assertEquals(usage.cacheReadTokens, 1200);
  assertEquals(usage.cacheWriteTokens, 100);
});

Deno.test("summarizeMessageUsage - a call that did not report tokens makes the sum partial", () => {
  const usage = summarizeMessageUsage([
    call({ inputTokens: 100, outputTokens: 20 }),
    call({ inputTokens: null, outputTokens: null }),
  ])!;
  assertEquals(usage.inputTokens, 100);
  assertEquals(usage.tokensComplete, false);
});

Deno.test("summarizeMessageUsage - tokens per second uses generation time only", () => {
  // Two calls of 2s, each with 0.5s to first token: 1.5s generating each.
  // 60 + 90 tokens over 3s of generation = 50 tok/s. The 10s gap between them
  // (a tool running) is not part of it.
  const usage = summarizeMessageUsage([
    call({ outputTokens: 60, durationMs: 2_000, ttftMs: 500, createdAt: 10_000 }),
    call({ outputTokens: 90, durationMs: 2_000, ttftMs: 500, createdAt: 22_000 }),
  ])!;
  assertEquals(usage.tokensPerSecond, 50);
});

Deno.test("summarizeMessageUsage - tokens per second is null without first-token timing", () => {
  const usage = summarizeMessageUsage([call({ ttftMs: null })])!;
  assertEquals(usage.tokensPerSecond, null);
});

Deno.test("summarizeMessageUsage - tokens per second skips calls that cannot be timed", () => {
  const usage = summarizeMessageUsage([
    call({ outputTokens: 60, durationMs: 2_000, ttftMs: 1_000 }),
    call({ outputTokens: 999, ttftMs: null }),
    call({ outputTokens: null, ttftMs: 100 }),
    call({ outputTokens: 999, status: "error", errorType: "network" }),
  ])!;
  assertEquals(usage.tokensPerSecond, 60);
});

Deno.test("summarizeMessageUsage - first token time is the first call's", () => {
  const usage = summarizeMessageUsage([
    call({ ttftMs: 900, createdAt: 20_000 }),
    call({ ttftMs: 300, createdAt: 10_000 }),
  ])!;
  assertEquals(usage.ttftMs, 300);
});

Deno.test("summarizeMessageUsage - latency is wall clock, tool waits included", () => {
  // First call starts at 8_000, the last ends at 22_000.
  const usage = summarizeMessageUsage([
    call({ durationMs: 2_000, createdAt: 10_000 }),
    call({ durationMs: 2_000, createdAt: 22_000 }),
  ])!;
  assertEquals(usage.latencyMs, 14_000);
});

Deno.test("summarizeMessageUsage - failed calls are counted, not summed", () => {
  const usage = summarizeMessageUsage([
    call({ status: "error", errorType: "rate_limit", inputTokens: null, outputTokens: null }),
    call({ inputTokens: 10, outputTokens: 5 }),
  ])!;
  assertEquals(usage.failedCalls, 1);
  assertEquals(usage.calls, 2);
  assertEquals(usage.inputTokens, 10);
  assertEquals(usage.tokensComplete, true);
});

Deno.test("summarizeMessageUsage - lists the models used, marked local or cloud", () => {
  const usage = summarizeMessageUsage([
    call({ createdAt: 10_000 }),
    call({
      provider: "anthropic",
      model: "claude-x",
      location: "cloud",
      keyAlias: "work",
      createdAt: 20_000,
    }),
    call({ createdAt: 30_000 }),
  ])!;
  assertEquals(usage.models, [
    { provider: "ollama", model: "llama3", location: "local", calls: 2 },
    { provider: "anthropic", model: "claude-x", location: "cloud", calls: 1 },
  ]);
});

Deno.test("summarizeConversationUsage - local and cloud are separate, with no combined figure", () => {
  const usage = summarizeConversationUsage([
    call({ inputTokens: 100, outputTokens: 10 }),
    call({ inputTokens: 200, outputTokens: 20 }),
    call({
      provider: "anthropic",
      model: "claude-x",
      location: "cloud",
      keyAlias: "work",
      inputTokens: 1_000,
      outputTokens: 300,
    }),
    call({
      provider: "anthropic",
      model: "claude-x",
      location: "cloud",
      keyAlias: "personal",
      inputTokens: 500,
      outputTokens: 100,
    }),
  ]);

  assertEquals(usage.local.inputTokens, 300);
  assertEquals(usage.local.calls, 2);
  assertEquals(usage.cloud.inputTokens, 1_500);
  assertEquals(usage.cloud.outputTokens, 400);
  assertEquals(usage.cloud.models.length, 1);
  assertEquals(usage.cloud.models[0].keyAliases, ["work", "personal"]);
  assertEquals(usage.cloud.models[0].calls, 2);
  assertEquals(Object.keys(usage).sort(), ["cloud", "local"]);
});

Deno.test("summarizeConversationUsage - an empty side has null figures, not zeros", () => {
  const usage = summarizeConversationUsage([call()]);
  assertEquals(usage.cloud.calls, 0);
  assertEquals(usage.cloud.inputTokens, null);
  assertEquals(usage.cloud.models, []);
});

Deno.test("groupByMessage - groups by message and leaves out unlinked calls", () => {
  const grouped = groupByMessage([
    call({ context: { kind: "chat", chatId: 1, messageId: 7 } }),
    call({ context: { kind: "chat", chatId: 1, messageId: 7 } }),
    call({ context: { kind: "chat", chatId: 1, messageId: 8 } }),
    call({ context: { kind: "chat", chatId: 1, messageId: null } }),
    call({ context: { kind: "other" } }),
  ]);
  assertEquals(grouped.get(7)?.length, 2);
  assertEquals(grouped.get(8)?.length, 1);
  assertEquals(grouped.size, 2);
});
