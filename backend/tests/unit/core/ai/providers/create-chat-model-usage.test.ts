import { assert, assertEquals } from "@std/assert";
import type { UsageEntry } from "../../../../../core/ai/usage/usage-recorder.ts";

import {
  createChatModel,
  setKeyAliasResolver,
} from "../../../../../core/ai/providers/create-chat-model.ts";
import { setUsageRecorder } from "../../../../../core/ai/usage/usage-recorder.ts";
import { withUsageContext } from "../../../../../core/ai/usage/usage-context.ts";

// Fake provider endpoints: the real ChatOllama / ChatAnthropic classes talk to
// them, so what is recorded is what the real clients report.
function ollamaReply(): Response {
  const lines = [
    { model: "llama3", message: { role: "assistant", content: "hi" }, done: false },
    {
      model: "llama3",
      message: { role: "assistant", content: "" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 21,
      eval_count: 8,
    },
  ];
  return new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", {
    headers: { "content-type": "application/x-ndjson" },
  });
}

function anthropicReply(): Response {
  return Response.json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5",
    content: [{ type: "text", text: "hi" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 30,
      output_tokens: 12,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 3,
    },
  });
}

async function withServer<T>(
  handler: (req: Request) => Response,
  envName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const server = Deno.serve({ port: 0, onListen() {} }, handler);
  const previous = Deno.env.get(envName);
  Deno.env.set(envName, `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);
  try {
    return await fn();
  } finally {
    if (previous === undefined) Deno.env.delete(envName);
    else Deno.env.set(envName, previous);
    await server.shutdown();
  }
}

function capture(): UsageEntry[] {
  const entries: UsageEntry[] = [];
  setUsageRecorder({
    record: (entry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  });
  return entries;
}

Deno.test("factory usage - a local model call is recorded as local with no key", async () => {
  const entries = capture();
  // The ollama client keeps the fetch it finds when it is built and has no
  // base-url hook in the factory, so swap fetch for that moment only.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(ollamaReply())) as typeof fetch;
  let model;
  try {
    model = await createChatModel(
      { provider: "ollama", model: "llama3" },
      {},
      () => Promise.resolve(undefined),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  await withUsageContext(
    { kind: "chat", role: "orchestrator", chatId: 1 },
    () => model.invoke("hello"),
  );
  setUsageRecorder(undefined);

  assertEquals(entries.length, 1);
  const { usage, link } = entries[0];
  assertEquals(usage.provider, "ollama");
  assertEquals(usage.location, "local");
  assertEquals(usage.keyId, null);
  assertEquals(usage.keyAlias, null);
  assertEquals(usage.inputTokens, 21);
  assertEquals(usage.outputTokens, 8);
  assertEquals(usage.cacheReadTokens, null);
  assertEquals(usage.reasoningTokens, null);
  assertEquals(usage.status, "ok");
  assertEquals(link, { kind: "chat", chatId: 1 });
});

Deno.test("factory usage - a cloud call keeps the key alias and cache tokens", async () => {
  const entries = capture();
  setKeyAliasResolver((id) => Promise.resolve(id === "k1" ? "work" : undefined));
  await withServer(() => anthropicReply(), "ANTHROPIC_BASE_URL", async () => {
    const model = await createChatModel(
      { provider: "anthropic", model: "claude-sonnet-4-5", keyId: "k1" },
      {},
      () => Promise.resolve("sk-test"),
    );
    await withUsageContext(
      { kind: "execution", role: "delegate", executionId: 5 },
      () => model.invoke("hello"),
    );
  });
  setKeyAliasResolver(() => Promise.resolve(undefined));
  setUsageRecorder(undefined);

  assertEquals(entries.length, 1);
  const { usage, link } = entries[0];
  assertEquals(usage.provider, "anthropic");
  assertEquals(usage.location, "cloud");
  assertEquals(usage.role, "delegate");
  assertEquals(usage.keyId, "k1");
  assertEquals(usage.keyAlias, "work");
  assertEquals(usage.cacheReadTokens, 5);
  assertEquals(usage.cacheWriteTokens, 3);
  assertEquals(usage.outputTokens, 12);
  assert(usage.inputTokens !== null);
  assertEquals(link, { kind: "execution", executionId: 5, nodeId: null });
});

Deno.test("factory usage - a rejected key is recorded as an error call", async () => {
  const entries = capture();
  await withServer(
    () => Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 }),
    "ANTHROPIC_BASE_URL",
    async () => {
      const model = await createChatModel(
        { provider: "anthropic", model: "claude-sonnet-4-5", keyId: "bad" },
        {},
        () => Promise.resolve("sk-bad"),
      );
      await model.invoke("hello").catch(() => undefined);
    },
  );
  setUsageRecorder(undefined);

  assertEquals(entries.length, 1);
  assertEquals(entries[0].usage.status, "error");
  assertEquals(entries[0].usage.errorType, "invalid_key");
  assertEquals(entries[0].usage.inputTokens, null);
});
