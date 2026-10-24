import { assertEquals, assertRejects } from "@std/assert";
import { AIMessageChunk } from "@langchain/core/messages";
import {
  StreamInterruptedError,
  streamToMessage,
} from "../../../../../../core/ai/visual-builder/execution/stream-model.ts";

function modelFrom(chunks: () => AsyncGenerator<AIMessageChunk>) {
  return { stream: () => Promise.resolve(chunks()) };
}

Deno.test("streamToMessage - accumulates text chunks and reports tokens", async () => {
  const model = modelFrom(async function* () {
    yield new AIMessageChunk("Hel");
    yield new AIMessageChunk("lo");
  });
  const tokens: string[] = [];
  const msg = await streamToMessage(model, [], { onToken: (t) => tokens.push(t) });
  assertEquals(msg.content, "Hello");
  assertEquals(tokens, ["Hel", "lo"]);
});

Deno.test("streamToMessage - keeps tool calls from the streamed chunks", async () => {
  const model = modelFrom(async function* () {
    yield new AIMessageChunk({
      content: "",
      tool_call_chunks: [
        { name: "search", args: '{"q":', id: "c1", index: 0, type: "tool_call_chunk" },
      ],
    });
    yield new AIMessageChunk({
      content: "",
      tool_call_chunks: [{ args: '"x"}', index: 0, type: "tool_call_chunk" }],
    });
  });
  const msg = await streamToMessage(model, []);
  assertEquals(msg.tool_calls?.length, 1);
  assertEquals(msg.tool_calls?.[0].name, "search");
  assertEquals(msg.tool_calls?.[0].args, { q: "x" });
});

Deno.test("streamToMessage - an error after partial text carries the partial", async () => {
  const model = modelFrom(async function* () {
    yield new AIMessageChunk("partial text");
    throw new Error("connection reset");
  });
  const err = await assertRejects(
    () => streamToMessage(model, []),
    StreamInterruptedError,
    "connection reset",
  );
  assertEquals((err as StreamInterruptedError).partial, "partial text");
});

Deno.test("streamToMessage - an error before any text is rethrown as is", async () => {
  const model = modelFrom(async function* () {
    throw new Error("401 unauthorized");
    yield new AIMessageChunk("");
  });
  await assertRejects(() => streamToMessage(model, []), Error, "401 unauthorized");
});

Deno.test("streamToMessage - idle timeout aborts a stalled stream", async () => {
  const model = {
    stream: (_: unknown, opts?: { signal?: AbortSignal }) =>
      Promise.resolve((async function* () {
        yield new AIMessageChunk("a");
        await new Promise((_, reject) =>
          opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        );
      })()),
  };
  const err = await assertRejects(
    () => streamToMessage(model, [], { idleTimeoutMs: 20 }),
    StreamInterruptedError,
    "no output",
  );
  assertEquals((err as StreamInterruptedError).partial, "a");
});

Deno.test("streamToMessage - external abort cancels and keeps the partial", async () => {
  const controller = new AbortController();
  const model = {
    stream: (_: unknown, opts?: { signal?: AbortSignal }) =>
      Promise.resolve((async function* () {
        yield new AIMessageChunk("x");
        controller.abort();
        if (opts?.signal?.aborted) throw new Error("aborted");
      })()),
  };
  const err = await assertRejects(
    () => streamToMessage(model, [], { signal: controller.signal }),
    StreamInterruptedError,
    "cancelled",
  );
  assertEquals((err as StreamInterruptedError).partial, "x");
});
