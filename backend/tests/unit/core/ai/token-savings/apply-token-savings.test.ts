import { assert, assertEquals } from "@std/assert";
import { createChatModel } from "../../../../../core/ai/providers/create-chat-model.ts";
import { setUsageRecorder } from "../../../../../core/ai/usage/usage-recorder.ts";
import { setTokenSavingsDefaults } from "../../../../../core/ai/token-savings/config.ts";
import { applyTokenSavings } from "../../../../../core/ai/token-savings/apply-token-savings.ts";
import { ALL_OFF, DEFAULT_TOKEN_SAVINGS } from "../../../../../core/ai/token-savings/config.ts";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";

const reply = () =>
  Response.json({
    id: "m", type: "message", role: "assistant", model: "claude-sonnet-4-5",
    content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });

async function withAnthropic<T>(
  handler: (body: Record<string, unknown>) => Response,
  fn: () => Promise<T>,
): Promise<T> {
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) =>
    handler(await req.json()));
  const prev = Deno.env.get("ANTHROPIC_BASE_URL");
  Deno.env.set("ANTHROPIC_BASE_URL", `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);
  setUsageRecorder({ record: () => Promise.resolve() });
  try {
    return await fn();
  } finally {
    if (prev === undefined) Deno.env.delete("ANTHROPIC_BASE_URL");
    else Deno.env.set("ANTHROPIC_BASE_URL", prev);
    setTokenSavingsDefaults(undefined);
    setUsageRecorder(undefined);
    await server.shutdown();
  }
}

const ref = { provider: "anthropic", model: "claude-sonnet-4-5", keyId: "k" } as const;
const secrets = () => Promise.resolve("sk-test");

Deno.test("caching - anthropic requests carry top-level cache_control by default", async () => {
  let body: Record<string, unknown> = {};
  await withAnthropic((b) => { body = b; return reply(); }, async () => {
    const m = await createChatModel(ref, {}, secrets);
    await m.invoke("hello");
  });
  assertEquals(body.cache_control, { type: "ephemeral" });
});

Deno.test("caching - tokenSavings:false sends no cache_control", async () => {
  let body: Record<string, unknown> = {};
  await withAnthropic((b) => { body = b; return reply(); }, async () => {
    const m = await createChatModel(ref, { tokenSavings: false }, secrets);
    await m.invoke("hello");
  });
  assert(!("cache_control" in body));
});

Deno.test("caching - a per-mechanism flag turns it off while others stay", async () => {
  let body: Record<string, unknown> = {};
  await withAnthropic((b) => { body = b; return reply(); }, async () => {
    const m = await createChatModel(ref, { tokenSavings: { promptCaching: false } }, secrets);
    await m.invoke("hello");
  });
  assert(!("cache_control" in body));
});

Deno.test("caching - streaming also carries cache_control", async () => {
  let body: Record<string, unknown> = {};
  await withAnthropic((b) => { body = b; return Response.json({ error: { type: "x", message: "stop" } }, { status: 400 }); }, async () => {
    const m = await createChatModel(ref, {}, secrets);
    try { for await (const _ of await m.stream("hi")) { /* drain */ } } catch { /* expected */ }
  });
  assertEquals(body.cache_control, { type: "ephemeral" });
});

Deno.test("caching - if the API rejects cache_control the call retries without it", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withAnthropic((b) => {
    bodies.push(b);
    return "cache_control" in b
      ? Response.json({ type: "error", error: { type: "invalid_request_error", message: "cache_control: Extra inputs are not permitted" } }, { status: 400 })
      : reply();
  }, async () => {
    const m = await createChatModel(ref, {}, secrets);
    const res = await m.invoke("hello");
    assertEquals(res.content, "hi");
  });
  assertEquals(bodies.length, 2);
  assert(!("cache_control" in bodies[1]));
});

Deno.test("pipeline - old tool results are compacted in the real request body", async () => {
  let body: { messages: { content: unknown }[] } = { messages: [] };
  const big = "y".repeat(60_000);
  await withAnthropic((b) => { body = b as never; return reply(); }, async () => {
    const m = await createChatModel(ref, {}, secrets);
    await m.invoke([
      new HumanMessage("go"),
      new AIMessage({ content: "", tool_calls: [{ id: "t1", name: "web_read", args: {} }] }),
      new ToolMessage({ content: big, tool_call_id: "t1", name: "web_read" }),
      new AIMessage({ content: "", tool_calls: [{ id: "t2", name: "web_read", args: {} }] }),
      new ToolMessage({ content: "z", tool_call_id: "t2", name: "web_read" }),
      new AIMessage({ content: "", tool_calls: [{ id: "t3", name: "web_read", args: {} }] }),
      new ToolMessage({ content: "z", tool_call_id: "t3", name: "web_read" }),
      new AIMessage({ content: "", tool_calls: [{ id: "t4", name: "web_read", args: {} }] }),
      new ToolMessage({ content: "z", tool_call_id: "t4", name: "web_read" }),
      new AIMessage("ok"),
      new HumanMessage("next"),
    ]);
  });
  const serialized = JSON.stringify(body.messages);
  assert(!serialized.includes("y".repeat(100)));
  assert(serialized.includes("omitted to save tokens"));
  assert(serialized.includes("t1"));
});

Deno.test("pipeline - a throwing mechanism falls back to the original messages", async () => {
  const llm = new ChatAnthropic({ model: "claude-sonnet-4-5", apiKey: "k", maxTokens: 10 });
  let received: unknown[] = [];
  // deno-lint-ignore no-explicit-any
  (llm as any)._generate = (m: unknown[]) => { received = m; return Promise.resolve({ generations: [] }); };
  applyTokenSavings(llm, ref, {
    ...DEFAULT_TOKEN_SAVINGS,
    promptCaching: false,
    summaryTriggerChars: 1,
    summaryMinHistoryChars: 1,
  }, { getSummarizer: () => Promise.reject(new Error("summarizer down")) });
  const original = [new HumanMessage("old"), new AIMessage("a"), new HumanMessage("now")];
  await llm._generate(original, {} as never);
  assert(received === original);
});

Deno.test("pipeline - unsupported providers are skipped without error (google gets no cache_control hook)", () => {
  // deno-lint-ignore no-explicit-any
  const fake: any = { invocationParams: () => ({}) };
  applyTokenSavings(fake, { provider: "google", model: "g", keyId: "k" }, { ...ALL_OFF, promptCaching: true }, {});
  assertEquals(fake.invocationParams(), {});
});

Deno.test("pipeline - local ollama models are never wrapped", async () => {
  const m = await createChatModel({ provider: "ollama", model: "llama3" });
  // deno-lint-ignore no-explicit-any
  assertEquals((m as any).__cachingDisabled, undefined);
});
