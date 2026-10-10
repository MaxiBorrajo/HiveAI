import { assertEquals, assertThrows, assertRejects } from "@std/assert";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  coerceLlmBooleanReply,
  buildPromptMessages,
  buildLlmInstance,
  mapResponseToState,
  handleLlmError,
  executeLlmNode,
} from "../../../../../../core/ai/visual-builder/execution/llm-executor.ts";
import { LlmConfig, ToolProvider } from "../../../../../../core/ai/visual-builder/types.ts";

// --- coerceLlmBooleanReply ---

Deno.test("coerceLlmBooleanReply - exact 'true'/'false' strings", () => {
  assertEquals(coerceLlmBooleanReply("true"), true);
  assertEquals(coerceLlmBooleanReply("false"), false);
});

Deno.test("coerceLlmBooleanReply - is case-insensitive and trims whitespace", () => {
  assertEquals(coerceLlmBooleanReply("  TRUE  "), true);
});

Deno.test("coerceLlmBooleanReply - accepts a leading 'true' followed by extra text", () => {
  assertEquals(coerceLlmBooleanReply("true, because the condition holds"), true);
});

Deno.test("coerceLlmBooleanReply - recognizes JSON-ish is_valid patterns", () => {
  assertEquals(coerceLlmBooleanReply('{"is_valid": true}'), true);
});

Deno.test("coerceLlmBooleanReply - explicit negations like 'not true' are recognized as false", () => {
  assertEquals(coerceLlmBooleanReply("that is not true"), false);
});

Deno.test("coerceLlmBooleanReply - plain 'false' with no 'true' substring is false", () => {
  assertEquals(coerceLlmBooleanReply("false, condition not met"), false);
});

// --- buildPromptMessages ---

Deno.test("buildPromptMessages - includes systemPrompt as a SystemMessage when set", () => {
  const messages = buildPromptMessages({}, { systemPrompt: "You are a helper." });
  assertEquals(messages[0] instanceof SystemMessage, true);
});

Deno.test("buildPromptMessages - injects feedback as a HumanMessage note", () => {
  const messages = buildPromptMessages({ feedback: "retry with more detail" }, {});
  const found = messages.some(
    (m) => m instanceof HumanMessage && String(m.content).includes("retry with more detail"),
  );
  assertEquals(found, true);
});

Deno.test("buildPromptMessages - replays state.messages preserving role mapping", () => {
  const messages = buildPromptMessages(
    {
      messages: [
        { role: "system", content: "sys" },
        { role: "assistant", content: "asst reply" },
        { role: "user", content: "user msg" },
      ],
    },
    {},
  );
  assertEquals(messages.some((m) => m instanceof SystemMessage && m.content === "sys"), true);
  assertEquals(messages.some((m) => m instanceof AIMessage && m.content === "asst reply"), true);
  assertEquals(messages.some((m) => m instanceof HumanMessage && m.content === "user msg"), true);
});

Deno.test("buildPromptMessages - with inputMapping, only maps declared keys as context (not the whole state)", () => {
  const messages = buildPromptMessages(
    { foo: "keep-me", bar: "hide-me" },
    { inputMapping: { relevantData: "foo" } },
  );
  const combined = messages.map((m) => String(m.content)).join("\n");
  assertEquals(combined.includes("keep-me"), true);
  assertEquals(combined.includes("hide-me"), false);
});

Deno.test("buildPromptMessages - without inputMapping, dumps the whole state as context (excluding reserved keys)", () => {
  const messages = buildPromptMessages(
    { foo: "included-value", model: "qwen3:8b" },
    {},
  );
  const combined = messages.map((m) => String(m.content)).join("\n");
  assertEquals(combined.includes("included-value"), true);
  // "model" is a reserved key and must not leak into the CONTEXT dump
  assertEquals(combined.includes("CONTEXT [model]"), false);
  assertEquals(combined.includes("qwen3:8b"), false);
});

Deno.test("buildPromptMessages - falls back to a default instruction when there is no human message and no context", () => {
  const messages = buildPromptMessages({}, { systemPrompt: "sys only" });
  const lastMsg = messages[messages.length - 1];
  assertEquals(lastMsg instanceof HumanMessage, true);
  assertEquals(String(lastMsg.content).includes("execute the designated task"), true);
});

Deno.test("buildPromptMessages - state.input is surfaced as USER GOAL context", () => {
  const messages = buildPromptMessages({ input: "Do the thing" }, {});
  const combined = messages.map((m) => String(m.content)).join("\n");
  assertEquals(combined.includes("USER GOAL / INPUT"), true);
  assertEquals(combined.includes("Do the thing"), true);
});

Deno.test("buildLlmInstance - throws when plugins are requested but no ToolProvider is given", async () => {
  await assertRejects(
    () => buildLlmInstance("n1", { model: "qwen3:8b", plugins: ["web-search"] }),
    Error,
    "no ToolProvider was injected",
  );
});

Deno.test("buildLlmInstance - throws when a requested plugin isn't registered in the provider", async () => {
  const provider: ToolProvider = { getTool: () => undefined };
  await assertRejects(
    () => buildLlmInstance("n1", { model: "qwen3:8b", plugins: ["missing-tool"] }, provider),
    Error,
    "is not registered in the Microkernel",
  );
});

Deno.test("buildLlmInstance - throws when no model is specified", async () => {
  await assertRejects(() => buildLlmInstance("n1", {}), Error, "No model was specified");
});

Deno.test("mapResponseToState - plain text response with outputKey sets both outputKey and result", () => {
  const state = mapResponseToState(new AIMessage("hello world"), { outputKey: "summary" }, {});
  assertEquals(state.summary, "hello world");
  assertEquals(state.result, "hello world");
});

Deno.test("mapResponseToState - no outputKey wraps the reply into a messages array plus result", () => {
  const state = mapResponseToState(new AIMessage("hi"), {}, {});
  assertEquals(state.result, "hi");
  assertEquals(Array.isArray(state.messages), true);
  assertEquals((state.messages as any[])[0].content, "hi");
});

Deno.test("mapResponseToState - outputKey 'result' does not duplicate into a second result field", () => {
  const state = mapResponseToState(new AIMessage("hi"), { outputKey: "result" }, {});
  assertEquals(state.result, "hi");
  assertEquals(Object.keys(state).length, 1);
});

Deno.test("mapResponseToState - boolean field coerces a string reply via coerceLlmBooleanReply", () => {
  const state = mapResponseToState(new AIMessage("true"), { outputKey: "is_valid" }, {});
  assertEquals(state.is_valid, true);
  assertEquals("result" in state, false);
});

Deno.test("mapResponseToState - boolean field with structuredOutput.type === 'boolean' passes booleans through", () => {
  const state = mapResponseToState(
    true,
    { outputKey: "custom_flag", structuredOutput: { type: "boolean", required: true } },
    {},
  );
  assertEquals(state.custom_flag, true);
});

Deno.test("mapResponseToState - boolean field derives from first value of a structured object reply", () => {
  const state = mapResponseToState(
    { is_valid: true, reason: "ok" },
    { outputKey: "is_approved", structuredOutput: { type: "object", required: true } },
    {},
  );
  assertEquals(state.is_approved, true);
});

Deno.test("mapResponseToState - structuredOutput passes the raw response through untouched", () => {
  const payload = { score: 9, label: "great" };
  const state = mapResponseToState(payload, { outputKey: "analysis", structuredOutput: { type: "object", required: true } }, {});
  assertEquals(state.analysis, payload);
});

Deno.test("mapResponseToState - carries forward attempts counter when present in state", () => {
  const state = mapResponseToState(new AIMessage("x"), { outputKey: "out" }, { attempts: 2 });
  assertEquals(state.attempts, 1);
});

// --- handleLlmError ---

Deno.test("handleLlmError - a model failure throws instead of producing fake output", () => {
  assertThrows(() => handleLlmError(new Error("connection refused"), "n1", {}), Error, "connection refused");
});

Deno.test("handleLlmError - structuredOutput configs also throw", () => {
  assertThrows(
    () => handleLlmError(new Error("timeout"), "n1", { outputKey: "r", structuredOutput: { type: "object", required: true } }),
    Error,
    "timeout",
  );
});

Deno.test("handleLlmError - non-Error thrown values are stringified", () => {
  assertThrows(() => handleLlmError("plain string failure", "n1", {}), Error, "plain string failure");
});

// --- executeLlmNode (error paths that don't require a live Ollama instance) ---

Deno.test("executeLlmNode - plugins requested without a ToolProvider fails the node", async () => {
  const config: LlmConfig = { model: "qwen3:8b", plugins: ["web-search"] };
  await assertRejects(() => executeLlmNode("n1", config, {}), Error, "no ToolProvider was provided");
});

// --- executeLlmNode ReAct loop (deterministic, via injected llmFactory) ---

// Builds a fake chat model whose .invoke() replies are taken one-by-one from
// `scriptedReplies` (an AIMessage per call). bindTools()/withStructuredOutput()
// just return `this` so the same scripted sequence keeps driving .invoke().
function fakeLlm(scriptedReplies: AIMessage[]) {
  let callIndex = 0;
  const model = {
    invoke: async (_messages: unknown[]) => {
      const reply = scriptedReplies[Math.min(callIndex, scriptedReplies.length - 1)];
      callIndex++;
      return reply;
    },
    bindTools: () => model,
    withStructuredOutput: () => model,
  };
  return model;
}

function fakeToolProvider(tools: Record<string, (args: any) => Promise<string> | string>): ToolProvider {
  return {
    getTool: (name: string) => {
      const handler = tools[name];
      if (!handler) return undefined;
      return { name, invoke: (args: unknown) => handler(args) } as any;
    },
  };
}

Deno.test("executeLlmNode - simple node with no plugins invokes the LLM once and maps the reply", async () => {
  const reply = new AIMessage("the final answer");
  const result = await executeLlmNode(
    "n1",
    { model: "fake-model", outputKey: "answer" },
    {},
    undefined,
    () => fakeLlm([reply]),
  );
  assertEquals(result.answer, "the final answer");
});

Deno.test("executeLlmNode - ReAct loop executes a requested tool call and feeds the result back", async () => {
  const toolCallReply = new AIMessage({
    content: "",
    tool_calls: [{ name: "counter", args: { name: "coffees" }, id: "call_1" }],
  });
  const finalReply = new AIMessage("Done, counted the coffees.");

  const provider = fakeToolProvider({
    counter: async (args) => `Counter '${args.name}' is now 5`,
  });

  const result = await executeLlmNode(
    "n1",
    { model: "fake-model", plugins: ["counter"], outputKey: "summary" },
    {},
    provider,
    () => fakeLlm([toolCallReply, finalReply]),
  );

  assertEquals(result.summary, "Done, counted the coffees.");
});

Deno.test("executeLlmNode - a requested plugin missing from the ToolProvider is skipped entirely (never bound, falls back to the no-tools path)", async () => {
  // When every requested plugin resolves to `undefined` in the provider,
  // toolsToBind stays empty, so the ReAct loop never starts at all — the
  // node silently falls back to a single plain LLM invocation (Case 1).
  const reply = new AIMessage("No tools were available, answering directly.");
  const provider = fakeToolProvider({});

  const result = await executeLlmNode(
    "n1",
    { model: "fake-model", plugins: ["nonexistent-tool"], outputKey: "summary" },
    {},
    provider,
    () => fakeLlm([reply]),
  );

  assertEquals(result.summary, "No tools were available, answering directly.");
});

Deno.test("executeLlmNode - a tool that throws is caught and recorded as an error ToolMessage, loop continues", async () => {
  const toolCallReply = new AIMessage({
    content: "",
    tool_calls: [{ name: "flaky", args: {}, id: "call_1" }],
  });
  const finalReply = new AIMessage("Recovered after tool failure.");

  const provider = fakeToolProvider({
    flaky: async () => {
      throw new Error("boom");
    },
  });

  const result = await executeLlmNode(
    "n1",
    { model: "fake-model", plugins: ["flaky"], outputKey: "summary" },
    {},
    provider,
    () => fakeLlm([toolCallReply, finalReply]),
  );

  assertEquals(result.summary, "Recovered after tool failure.");
});

Deno.test("executeLlmNode - the loop stops at maxIterations (8) if the model keeps requesting tool calls", async () => {
  const alwaysToolCall = new AIMessage({
    content: "",
    tool_calls: [{ name: "counter", args: {}, id: "call_x" }],
  });
  const provider = fakeToolProvider({ counter: async () => "ok" });

  let invokeCount = 0;
  const model = {
    invoke: async () => {
      invokeCount++;
      return alwaysToolCall;
    },
    bindTools: () => model,
    withStructuredOutput: () => model,
  };

  const result = await executeLlmNode(
    "n1",
    { model: "fake-model", plugins: ["counter"], outputKey: "summary" },
    {},
    provider,
    () => model,
  );

  // Must terminate after exactly 8 model invocations, not hang forever
  assertEquals(invokeCount, 8);
  // With no non-tool-call final reply, it falls back to the last conversation entry
  // (a ToolMessage), so `summary` is populated from whatever that message's content is.
  assertEquals("summary" in result, true);
});

Deno.test("executeLlmNode - a thrown error from the LLM factory fails the node", async () => {
  await assertRejects(
    () =>
      executeLlmNode("n1", { model: "fake-model", outputKey: "answer" }, {}, undefined, () => {
        throw new Error("ollama connection refused");
      }),
    Error,
    "ollama connection refused",
  );
});

// --- provider-aware model construction ---

Deno.test("executeLlmNode - passes provider + keyId to the factory and drops ollama options for cloud nodes", async () => {
  let seen: Record<string, unknown> = {};
  await executeLlmNode(
    "cloud",
    { model: "claude-sonnet-5-5", provider: "anthropic", keyId: "k1", numCtx: 8192 },
    {},
    undefined,
    (opts) => {
      seen = opts;
      return { invoke: () => Promise.resolve(new AIMessage("ok")) };
    },
  );
  assertEquals(seen.provider, "anthropic");
  assertEquals(seen.keyId, "k1");
  assertEquals("numCtx" in seen, false);
});

Deno.test("executeLlmNode - local nodes keep ollama options and default to the ollama provider", async () => {
  let seen: Record<string, unknown> = {};
  await executeLlmNode("local", { model: "qwen3:8b", numCtx: 4096 }, {}, undefined, (opts) => {
    seen = opts;
    return { invoke: () => Promise.resolve(new AIMessage("ok")) };
  });
  assertEquals(seen.provider, "ollama");
  assertEquals(seen.numCtx, 4096);
});

Deno.test("executeLlmNode - a provider error fails the node with a clear message", async () => {
  await assertRejects(
    () =>
      executeLlmNode(
        "n1",
        { model: "gemini-2.5-flash", provider: "google", keyId: "k", outputKey: "out" },
        {},
        undefined,
        () => ({ invoke: () => Promise.reject(Object.assign(new Error("401"), { status: 401 })) }),
      ),
    Error,
    "API key was rejected",
  );
});
