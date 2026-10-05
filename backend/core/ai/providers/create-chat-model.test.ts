import { assert, assertEquals, assertRejects } from "@std/assert";
import { ChatOllama } from "@langchain/ollama";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createChatModel } from "./create-chat-model.ts";
import { ModelUnavailableError, normalizeProviderError } from "./errors.ts";
import { normalizeModelRef } from "./types.ts";
import { validateApiKey } from "./validate-key.ts";

const secrets: Record<string, string> = { k1: "sk-one", k2: "sk-two" };
const resolve = (id: string) => Promise.resolve(secrets[id]);

Deno.test("createChatModel - local ollama keeps ollama-specific options", async () => {
  const m = (await createChatModel(
    { provider: "ollama", model: "llama3" },
    { numCtx: 8192, temperature: 0.3 },
    resolve,
  )) as ChatOllama;
  assert(m instanceof ChatOllama);
  assertEquals(m.numCtx, 8192);
});

Deno.test("createChatModel - ollama cloud uses remote url + bearer header, drops ollama options", async () => {
  const m = (await createChatModel(
    { provider: "ollama-cloud", model: "glm-4.6:cloud", keyId: "k1" },
    { numCtx: 8192, temperature: 0.3 },
    resolve,
  )) as ChatOllama;
  assert(m instanceof ChatOllama);
  assertEquals(m.numCtx, undefined);
  // deno-lint-ignore no-explicit-any
  assertEquals((m as any).client.config.host, "https://ollama.com:443");
});

Deno.test("createChatModel - builds anthropic/openai/google", async () => {
  assert(
    (await createChatModel(
      { provider: "anthropic", model: "claude-sonnet-5-5", keyId: "k1" },
      {},
      resolve,
    )) instanceof ChatAnthropic,
  );
  assert(
    (await createChatModel(
      { provider: "openai", model: "gpt-x", keyId: "k2" },
      { numCtx: 1 },
      resolve,
    )) instanceof ChatOpenAI,
  );
  assert(
    (await createChatModel(
      { provider: "google", model: "gemini-x", keyId: "k1" },
      {},
      resolve,
    )) instanceof ChatGoogleGenerativeAI,
  );
});

Deno.test("createChatModel - missing / deleted key explains why", async () => {
  await assertRejects(
    () =>
      createChatModel({ provider: "openai", model: "gpt-x" }, {}, resolve),
    ModelUnavailableError,
    "no API key",
  );
  await assertRejects(
    () =>
      createChatModel(
        { provider: "openai", model: "gpt-x", keyId: "gone" },
        {},
        resolve,
      ),
    ModelUnavailableError,
    "no longer exists",
  );
});

Deno.test("normalizeModelRef - legacy string is local ollama", () => {
  assertEquals(normalizeModelRef("llama3"), {
    provider: "ollama",
    model: "llama3",
  });
  assertEquals(
    normalizeModelRef("m", { provider: "openai", keyId: "k1" }),
    { provider: "openai", model: "m", keyId: "k1" },
  );
});

Deno.test("normalizeProviderError - classifies statuses", () => {
  assertEquals(normalizeProviderError({ status: 401 }, "openai").kind, "invalid_key");
  assertEquals(normalizeProviderError({ status: 429 }).kind, "rate_limit");
  assertEquals(normalizeProviderError(new Error("fetch failed")).kind, "network");
});

Deno.test("validateApiKey - ok, invalid and two keys of the same provider", async () => {
  const fake: typeof fetch = (_url, init) => {
    const key = (init?.headers as Record<string, string>)["x-api-key"];
    return Promise.resolve(new Response("{}", { status: key === "good" ? 200 : 401 }));
  };
  await validateApiKey("anthropic", "good", fake);
  await validateApiKey("anthropic", "good", fake);
  await assertRejects(
    () => validateApiKey("anthropic", "bad", fake),
    Error,
    "rejected",
  );
});
