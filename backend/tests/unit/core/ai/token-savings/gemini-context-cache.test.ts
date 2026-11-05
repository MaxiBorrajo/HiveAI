import { assert, assertEquals } from "@std/assert";
import {
  clearGeminiCacheRegistry,
  patchGeminiContextCache,
} from "../../../../../core/ai/token-savings/gemini-context-cache.ts";
import { applyTokenSavings } from "../../../../../core/ai/token-savings/apply-token-savings.ts";
import { ALL_OFF, DEFAULT_TOKEN_SAVINGS } from "../../../../../core/ai/token-savings/config.ts";

const cfg = { geminiCacheTtlSeconds: 600, geminiCacheMinChars: 100 };
// deno-lint-ignore no-explicit-any
type Any = any;

function fakeModel(baseUrl: string, failCached = false) {
  const seen: Any[] = [];
  const client: Any = {
    systemInstruction: { role: "system", parts: [{ text: "S".repeat(300) }] },
    _requestOptions: { baseUrl },
    generateContent: (req: Any) => {
      seen.push(req);
      if (failCached && req.cachedContent) return Promise.reject(new Error("cache expired"));
      return Promise.resolve({ ok: true });
    },
    generateContentStream: (req: Any) => {
      seen.push(req);
      return Promise.resolve({ ok: true });
    },
  };
  return { model: { client, apiKey: "k", model: "gemini-2.5-flash" } as Any, seen };
}

const request = () => ({
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  tools: [{ functionDeclarations: [{ name: "t", description: "d".repeat(200) }] }],
});

async function withCacheApi<T>(
  status: number,
  fn: (baseUrl: string, creates: Any[]) => Promise<T>,
): Promise<T> {
  clearGeminiCacheRegistry();
  const creates: Any[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    creates.push(await req.json());
    return status === 200
      ? Response.json({ name: "cachedContents/abc" })
      : Response.json({ error: { message: "too few tokens" } }, { status });
  });
  try {
    return await fn(`http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`, creates);
  } finally {
    await server.shutdown();
  }
}

Deno.test("gemini cache - system instruction and tools move into cachedContent", async () => {
  await withCacheApi(200, async (url, creates) => {
    const { model, seen } = fakeModel(url);
    patchGeminiContextCache(model, cfg);
    await model.client.generateContent(request());
    await model.client.generateContentStream(request());
    assertEquals(seen[0].cachedContent, "cachedContents/abc");
    assert("tools" in seen[0] && seen[0].tools === undefined);
    assert(seen[0].systemInstruction === undefined);
    assertEquals(seen[0].contents.length, 1);
    assertEquals(seen[1].cachedContent, "cachedContents/abc");
    assertEquals(creates.length, 1);
    assertEquals(creates[0].model, "models/gemini-2.5-flash");
    assertEquals(creates[0].ttl, "600s");
  });
});

Deno.test("gemini cache - a prefix that is too small is sent as is", async () => {
  await withCacheApi(200, async (url, creates) => {
    const { model, seen } = fakeModel(url);
    patchGeminiContextCache(model, { ...cfg, geminiCacheMinChars: 1e6 });
    const req = request();
    await model.client.generateContent(req);
    assert(seen[0] === req);
    assertEquals(creates.length, 0);
  });
});

Deno.test("gemini cache - the API refusing to create a cache falls back to the plain request", async () => {
  await withCacheApi(400, async (url) => {
    const { model, seen } = fakeModel(url);
    patchGeminiContextCache(model, cfg);
    const req = request();
    await model.client.generateContent(req);
    assert(seen[0] === req);
  });
});

Deno.test("gemini cache - a cached request that fails is retried without the cache", async () => {
  await withCacheApi(200, async (url) => {
    const { model, seen } = fakeModel(url, true);
    patchGeminiContextCache(model, cfg);
    const req = request();
    const res = await model.client.generateContent(req);
    assertEquals(res, { ok: true });
    assertEquals(seen.length, 2);
    assert(seen[1] === req);
  });
});

Deno.test("gemini cache - off by default: the client is not touched", () => {
  const { model } = fakeModel("http://x");
  const original = model.client.generateContent;
  applyTokenSavings(model, { provider: "google", model: "g", keyId: "k" }, DEFAULT_TOKEN_SAVINGS, {});
  assert(model.client.generateContent === original);
  applyTokenSavings(model, { provider: "google", model: "g", keyId: "k" }, { ...ALL_OFF, geminiContextCache: true }, {});
  assert(model.client.generateContent !== original);
});
