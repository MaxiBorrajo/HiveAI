import type { TokenSavingsConfig } from "./config.ts";

// deno-lint-ignore no-explicit-any
type AnyModel = any;
// deno-lint-ignore no-explicit-any
type AnyRequest = Record<string, any>;

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const REFRESH_MARGIN_MS = 60_000;
const NEGATIVE_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 20;

type Entry = { name: string; expiresAt: number } | { failedUntil: number };
const entries = new Map<string, Promise<Entry>>();

export function clearGeminiCacheRegistry(): void {
  entries.clear();
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function createCache(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prefix: AnyRequest,
  ttlSeconds: number,
): Promise<Entry> {
  try {
    const res = await fetch(`${baseUrl}/v1beta/cachedContents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: modelName.includes("/") ? modelName : `models/${modelName}`,
        ttl: `${ttlSeconds}s`,
        ...prefix,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Typically "too few tokens to cache" or an unsupported model.
      await res.body?.cancel();
      return { failedUntil: Date.now() + NEGATIVE_TTL_MS };
    }
    const json = await res.json() as { name?: string };
    return json.name
      ? { name: json.name, expiresAt: Date.now() + ttlSeconds * 1000 }
      : { failedUntil: Date.now() + NEGATIVE_TTL_MS };
  } catch {
    return { failedUntil: Date.now() + NEGATIVE_TTL_MS };
  }
}

/**
 * Gemini explicit context caching for the stable prefix (system instruction +
 * tool definitions). Gemini rejects a cached request that also sends those, so
 * they are removed from the request and replaced by `cachedContent`. Any
 * problem (cache too small, API error) sends the original request.
 */
export function patchGeminiContextCache(
  model: AnyModel,
  cfg: Pick<
    TokenSavingsConfig,
    "geminiCacheTtlSeconds" | "geminiCacheMinChars"
  >,
): void {
  const client = model?.client;
  const apiKey: string | undefined = model?.apiKey;
  const modelName: string | undefined = model?.model;
  if (!client || !apiKey || !modelName) return;
  const baseUrl: string = client._requestOptions?.baseUrl ?? DEFAULT_BASE_URL;

  const cachedRequest = async (
    request: AnyRequest,
  ): Promise<AnyRequest | undefined> => {
    const systemInstruction = client.systemInstruction;
    const tools = request.tools;
    const toolConfig = request.toolConfig;
    if (request.cachedContent || (!systemInstruction && !tools?.length)) return;

    const prefix: AnyRequest = {};
    if (systemInstruction) prefix.systemInstruction = systemInstruction;
    if (tools?.length) prefix.tools = tools;
    if (toolConfig) prefix.toolConfig = toolConfig;
    const serialized = JSON.stringify(prefix);
    if (serialized.length < cfg.geminiCacheMinChars) return;

    const key = await sha256(`${modelName}\n${serialized}`);
    let pending = entries.get(key);
    const stale = async (p: Promise<Entry>) => {
      const e = await p;
      return "name" in e
        ? e.expiresAt - Date.now() < REFRESH_MARGIN_MS
        : e.failedUntil < Date.now();
    };
    if (!pending || await stale(pending)) {
      if (entries.size >= CACHE_LIMIT) {
        entries.delete(entries.keys().next().value as string);
      }
      pending = createCache(baseUrl, apiKey, modelName, prefix, cfg.geminiCacheTtlSeconds);
      entries.set(key, pending);
    }
    const entry = await pending;
    if (!("name" in entry)) return;
    return {
      ...request,
      tools: undefined,
      toolConfig: undefined,
      systemInstruction: undefined,
      cachedContent: entry.name,
    };
  };

  for (const method of ["generateContent", "generateContentStream"]) {
    if (typeof client[method] !== "function") continue;
    const original = client[method].bind(client);
    client[method] = async (request: AnyRequest, ...rest: unknown[]) => {
      let optimized: AnyRequest | undefined;
      try {
        optimized = await cachedRequest(request);
      } catch (error) {
        console.warn("[token-savings] gemini context cache failed:", error);
      }
      if (!optimized) return await original(request, ...rest);
      try {
        return await original(optimized, ...rest);
      } catch (error) {
        // The cache may have expired or been rejected: retry without it.
        console.warn("[token-savings] gemini cached request failed, retrying plain:", error);
        entries.clear();
        return await original(request, ...rest);
      }
    };
  }
}
