import { assertEquals, assertRejects } from "@std/assert";
import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  classifyUsageError,
  UsageCallbackHandler,
} from "../../../../../core/ai/usage/usage-callback.ts";
import { withUsageContext } from "../../../../../core/ai/usage/usage-context.ts";
import {
  setUsageRecorder,
  type UsageEntry,
} from "../../../../../core/ai/usage/usage-recorder.ts";

type Usage = AIMessage["usage_metadata"];

class FakeModel extends BaseChatModel {
  constructor(
    private behaviour: { usage?: Usage; fail?: Error },
    params: BaseChatModelParams = {},
  ) {
    super(params);
  }
  _llmType() {
    return "fake";
  }
  _generate(_m: BaseMessage[]): Promise<ChatResult> {
    if (this.behaviour.fail) return Promise.reject(this.behaviour.fail);
    const message = new AIMessage({
      content: "hi",
      usage_metadata: this.behaviour.usage,
    });
    return Promise.resolve({
      generations: [{ text: "hi", message }],
    });
  }
  override async *_streamResponseChunks(
    _m: BaseMessage[],
    _o: this["ParsedCallOptions"],
    run?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    if (this.behaviour.fail) throw this.behaviour.fail;
    await new Promise((r) => setTimeout(r, 15));
    const chunk = new ChatGenerationChunk({
      text: "hi",
      message: new AIMessageChunk({
        content: "hi",
        usage_metadata: this.behaviour.usage,
      }),
    });
    yield chunk;
    await run?.handleLLMNewToken("hi");
  }
}

const info = {
  provider: "anthropic",
  model: "claude-x",
  location: "cloud" as const,
  keyId: "key-1",
  keyAlias: "work",
};

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

function modelWith(
  behaviour: { usage?: Usage; fail?: Error },
  handler = new UsageCallbackHandler(info),
) {
  return new FakeModel(behaviour, { callbacks: [handler] });
}

Deno.test("usage callback - records every reported figure", async () => {
  const entries = capture();
  await modelWith({
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_token_details: { cache_read: 4, cache_creation: 2 },
      output_token_details: { reasoning: 3 },
    },
  }).invoke("hello");
  setUsageRecorder(undefined);

  assertEquals(entries.length, 1);
  const { usage, link } = entries[0];
  assertEquals(usage.inputTokens, 10);
  assertEquals(usage.outputTokens, 5);
  assertEquals(usage.cacheReadTokens, 4);
  assertEquals(usage.cacheWriteTokens, 2);
  assertEquals(usage.reasoningTokens, 3);
  assertEquals(usage.status, "ok");
  assertEquals(usage.errorType, null);
  assertEquals(usage.provider, "anthropic");
  assertEquals(usage.location, "cloud");
  assertEquals(usage.keyId, "key-1");
  assertEquals(usage.keyAlias, "work");
  assertEquals(link, { kind: "other" });
});

Deno.test("usage callback - figures the provider did not report stay null, never 0", async () => {
  const entries = capture();
  await modelWith({
    usage: { input_tokens: 7, output_tokens: 0, total_tokens: 7 },
  }).invoke("hello");
  await modelWith({ usage: undefined }).invoke("hello");
  setUsageRecorder(undefined);

  const [partial, none] = entries.map((e) => e.usage);
  assertEquals(partial.inputTokens, 7);
  // A reported 0 is a real figure; absent ones are null.
  assertEquals(partial.outputTokens, 0);
  assertEquals(partial.cacheReadTokens, null);
  assertEquals(partial.cacheWriteTokens, null);
  assertEquals(partial.reasoningTokens, null);

  assertEquals(none.inputTokens, null);
  assertEquals(none.outputTokens, null);
  assertEquals(none.reasoningTokens, null);
});

Deno.test("usage callback - time to first token only when the call streamed", async () => {
  const entries = capture();
  const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };
  await modelWith({ usage }).invoke("plain");
  const stream = await modelWith({ usage }).stream("streamed");
  for await (const _ of stream) { /* drain */ }
  setUsageRecorder(undefined);

  assertEquals(entries[0].usage.ttftMs, null);
  const streamed = entries[1].usage;
  assertEquals(typeof streamed.ttftMs, "number");
  assertEquals(streamed.ttftMs! <= streamed.durationMs, true);
});

Deno.test("usage callback - failed calls are recorded with their error type", async () => {
  const entries = capture();
  await assertRejects(() =>
    modelWith({ fail: Object.assign(new Error("denied"), { status: 401 }) })
      .invoke("hello")
  );
  await assertRejects(() =>
    modelWith({ fail: Object.assign(new Error("slow down"), { status: 429 }) })
      .invoke("hello")
  );
  setUsageRecorder(undefined);

  assertEquals(entries.map((e) => e.usage.status), ["error", "error"]);
  assertEquals(entries.map((e) => e.usage.errorType), [
    "invalid_key",
    "rate_limit",
  ]);
  assertEquals(entries[0].usage.inputTokens, null);
});

Deno.test("classifyUsageError - network, abort and unknown", () => {
  assertEquals(classifyUsageError(new Error("fetch failed"), "ollama"), "network");
  const abort = new Error("This operation was aborted");
  abort.name = "AbortError";
  assertEquals(classifyUsageError(abort, "ollama"), "aborted");
  assertEquals(classifyUsageError(new Error("boom"), "ollama"), "unknown");
});

Deno.test("usage callback - context and group come from the ambient usage context", async () => {
  const entries = capture();
  const model = modelWith({
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });
  await withUsageContext(
    { kind: "chat", role: "orchestrator", chatId: 42, groupId: "g-1" },
    async () => {
      await model.invoke("one");
      await model.invoke("two");
    },
  );
  await withUsageContext(
    { kind: "execution", role: "delegate", executionId: 9 },
    () => model.invoke("three"),
  );
  setUsageRecorder(undefined);

  assertEquals(entries.length, 3);
  assertEquals(entries[0].usage.groupId, "g-1");
  assertEquals(entries[1].usage.groupId, "g-1");
  assertEquals(entries[0].usage.contextKind, "chat");
  assertEquals(entries[0].usage.role, "orchestrator");
  assertEquals(entries[0].link, { kind: "chat", chatId: 42 });

  assertEquals(entries[2].usage.contextKind, "execution");
  assertEquals(entries[2].usage.role, "delegate");
  assertEquals(entries[2].usage.groupId === "g-1", false);
  assertEquals(entries[2].link, {
    kind: "execution",
    executionId: 9,
    nodeId: null,
  });
});

Deno.test("usage callback - a recorder failure never breaks the model call", async () => {
  setUsageRecorder({ record: () => Promise.reject(new Error("db is down")) });
  const reply = await modelWith({}).invoke("hello");
  setUsageRecorder(undefined);
  assertEquals(reply.content, "hi");
});
