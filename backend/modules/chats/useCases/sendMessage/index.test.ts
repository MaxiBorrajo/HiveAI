import { assertEquals } from "@std/assert";
import { appendThinkingDelta, consumeStream } from "./index.ts";
import type { ChatStep } from "../../../../core/ai/strategy/SCOUT/graph.ts";
import type { ThinkingRun } from "../../../../core/memory/types.ts";

function step(overrides: Partial<ChatStep> = {}): ChatStep {
  return {
    node: "Executor",
    label: "file_read",
    durationMs: 10,
    summary: "",
    ...overrides,
  };
}

// ---- appendThinkingDelta ----

Deno.test("appendThinkingDelta - starts a new run when the list is empty", () => {
  const runs: ThinkingRun[] = [];

  appendThinkingDelta(runs, "Hello", "Solver");

  assertEquals(runs, [{ node: "Solver", text: "Hello" }]);
});

Deno.test("appendThinkingDelta - merges consecutive deltas from the same node into one run", () => {
  const runs: ThinkingRun[] = [];

  appendThinkingDelta(runs, "Hel", "Solver");
  appendThinkingDelta(runs, "lo ", "Solver");
  appendThinkingDelta(runs, "world", "Solver");

  assertEquals(runs, [{ node: "Solver", text: "Hello world" }]);
});

Deno.test("appendThinkingDelta - starts a NEW run when the node changes mid-stream", () => {
  const runs: ThinkingRun[] = [];

  appendThinkingDelta(runs, "thinking as solver", "Solver");
  appendThinkingDelta(runs, "thinking as diagnostician", "Diagnostician");

  assertEquals(runs, [
    { node: "Solver", text: "thinking as solver" },
    { node: "Diagnostician", text: "thinking as diagnostician" },
  ]);
});

Deno.test("appendThinkingDelta - node can flip back and forth, each switch starts a new run", () => {
  const runs: ThinkingRun[] = [];

  appendThinkingDelta(runs, "a", "Solver");
  appendThinkingDelta(runs, "b", "Diagnostician");
  appendThinkingDelta(runs, "c", "Solver");

  assertEquals(runs.length, 3);
  assertEquals(
    runs.map((r) => r.node),
    ["Solver", "Diagnostician", "Solver"],
  );
});

Deno.test("appendThinkingDelta - undefined node is treated as its own distinct group", () => {
  const runs: ThinkingRun[] = [];

  appendThinkingDelta(runs, "a", undefined);
  appendThinkingDelta(runs, "b", undefined);

  assertEquals(runs, [{ node: undefined, text: "ab" }]);
});

// ---- consumeStream ----

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

type SentEvent = { event: string; data: unknown };

function collectSends() {
  const sent: SentEvent[] = [];
  const send = (event: string, data: unknown) => {
    sent.push({ event, data });
  };
  return { sent, send };
}

Deno.test("consumeStream - accumulates only tokens from the designated final node", async () => {
  const { sent, send } = collectSends();

  const chunks = toAsyncIterable([
    [
      "messages",
      [{ content: "Hello" }, { langgraph_node: "Agent" }],
    ],
    [
      "messages",
      [{ content: " world" }, { langgraph_node: "Agent" }],
    ],
  ]);

  const result = await consumeStream(chunks, "Agent", send);

  assertEquals(result.fullContent, "Hello world");
  assertEquals(
    sent.filter((s) => s.event === "token").map((s) => s.data),
    [{ content: "Hello" }, { content: " world" }],
  );
});

Deno.test("consumeStream - ignores message tokens from nodes other than the final node", async () => {
  const { sent, send } = collectSends();

  const chunks = toAsyncIterable([
    [
      "messages",
      [{ content: "internal reasoning" }, { langgraph_node: "Solver" }],
    ],
    [
      "messages",
      [{ content: "final answer" }, { langgraph_node: "Agent" }],
    ],
  ]);

  const result = await consumeStream(chunks, "Agent", send);

  assertEquals(result.fullContent, "final answer");
  assertEquals(sent.filter((s) => s.event === "token").length, 1);
});

Deno.test("consumeStream - routes reasoning_content to thinking_delta regardless of node, and merges by node", async () => {
  const { sent, send } = collectSends();

  const chunks = toAsyncIterable([
    [
      "messages",
      [
        {
          content: "",
          additional_kwargs: { reasoning_content: "step 1..." },
        },
        { langgraph_node: "Diagnostician" },
      ],
    ],
    [
      "messages",
      [
        {
          content: "",
          additional_kwargs: { reasoning_content: "step 2..." },
        },
        { langgraph_node: "Diagnostician" },
      ],
    ],
  ]);

  const result = await consumeStream(chunks, "Agent", send);

  assertEquals(result.thinkingRuns, [
    { node: "Diagnostician", text: "step 1...step 2..." },
  ]);
  assertEquals(
    sent.filter((s) => s.event === "thinking_delta").length,
    2,
  );
});

Deno.test("consumeStream - empty-string content chunks are dropped, not sent as empty tokens", async () => {
  const { sent, send } = collectSends();

  const chunks = toAsyncIterable([
    ["messages", [{ content: "" }, { langgraph_node: "Agent" }]],
    ["messages", [{ content: "real" }, { langgraph_node: "Agent" }]],
  ]);

  const result = await consumeStream(chunks, "Agent", send);

  assertEquals(result.fullContent, "real");
  assertEquals(sent.filter((s) => s.event === "token").length, 1);
});

Deno.test("consumeStream - a later 'values' chunk fully replaces the steps array, not appends", async () => {
  const { send } = collectSends();

  const chunks = toAsyncIterable([
    ["values", { steps: [step({ label: "first" })] }],
    [
      "values",
      { steps: [step({ label: "second" }), step({ label: "third" })] },
    ],
  ]);

  const result = await consumeStream(chunks, "Agent", send);

  assertEquals(result.steps.map((s) => s.label), ["second", "third"]);
});

Deno.test("consumeStream - a stream with no matching final-node tokens returns empty content but no error", async () => {
  const { send } = collectSends();

  const chunks = toAsyncIterable([
    ["messages", [{ content: "not final" }, { langgraph_node: "Solver" }]],
  ]);

  const result = await consumeStream(chunks, "Agent", send);

  assertEquals(result.fullContent, "");
  assertEquals(result.steps, []);
  assertEquals(result.thinkingRuns, []);
});

Deno.test("consumeStream - an empty stream resolves to empty content, steps, and thinking runs", async () => {
  const { send } = collectSends();

  const result = await consumeStream(toAsyncIterable([]), "Agent", send);

  assertEquals(result, { fullContent: "", steps: [], thinkingRuns: [] });
});

Deno.test("consumeStream - interleaved messages and values chunks are both handled in order", async () => {
  const { send } = collectSends();

  const chunks = toAsyncIterable([
    ["values", { steps: [step({ label: "searching" })] }],
    ["messages", [{ content: "Found it: " }, { langgraph_node: "Agent" }]],
    ["values", { steps: [step({ label: "answered" })] }],
    ["messages", [{ content: "42" }, { langgraph_node: "Agent" }]],
  ]);

  const result = await consumeStream(chunks, "Agent", send);

  assertEquals(result.fullContent, "Found it: 42");
  assertEquals(result.steps.map((s) => s.label), ["answered"]);
});
