import { assertEquals } from "@std/assert";
import { HfClient } from "../../../../modules/model-discovery/lib/hf-client.ts";
import {
  type DiscoveryDeps,
  getModelDetail,
  searchModels,
} from "../../../../modules/model-discovery/use-cases/model-discovery.ts";
import {
  buildHardwareReport,
  pickCloudSuggestion,
} from "../../../../modules/hardware/use-cases/get-hardware.ts";
import type { FitContext, HardwareProfile } from "../../../../modules/hardware/types.ts";

const GB = 1024 ** 3;
const CTX: FitContext = { nCtx: 8192, pluginTokens: 0, kvCacheType: "f16" };
const GPU: HardwareProfile = {
  totalMemBytes: 32 * GB,
  availableMemBytes: 24 * GB,
  gpu: { usable: true, vramBytes: 12 * GB, unifiedMemory: false },
};
const NO_GPU: HardwareProfile = {
  totalMemBytes: 8 * GB,
  availableMemBytes: 1.2 * GB,
  gpu: { usable: false, unifiedMemory: false },
};

const REPOS: Record<string, unknown> = {
  "u/big-GGUF": {
    id: "u/big-GGUF",
    gguf: { total: 70e9, context_length: 32768, chat_template: "tools" },
  },
  "u/mid-GGUF": {
    id: "u/mid-GGUF",
    gguf: { total: 8e9, context_length: 32768, chat_template: "tools" },
  },
  "u/embed-GGUF": { id: "u/embed-GGUF", pipeline_tag: "feature-extraction" },
};

function fakeFetch(online = true): typeof fetch {
  return ((input: string | URL | Request) => {
    if (!online) return Promise.reject(new Error("offline"));
    const url = String(input);
    if (url.includes("/api/models?")) {
      return Promise.resolve(Response.json(Object.values(REPOS)));
    }
    const tree = /api\/models\/(.+)\/tree/.exec(url);
    if (tree) {
      return Promise.resolve(Response.json([
        { type: "file", path: "m-Q4_K_M.gguf", size: 5 * GB },
        { type: "file", path: "m-Q2_K.gguf", size: 3 * GB },
      ]));
    }
    if (url.endsWith("README.md")) {
      return Promise.resolve(new Response("A model for local agents that is quite small and quick.\n"));
    }
    const model = /api\/models\/([^?]+)\?/.exec(url);
    const body = model && REPOS[model[1]];
    return Promise.resolve(body ? Response.json(body) : new Response("", { status: 404 }));
  }) as typeof fetch;
}

const deps = (profile: HardwareProfile, online = true): DiscoveryDeps => ({
  hf: new HfClient(fakeFetch(online)),
  profile: () => Promise.resolve(profile),
  fitContext: () => Promise.resolve(CTX),
});

Deno.test("searchModels - rates each result on the GPU profile and drops embedding models", async () => {
  const r = await searchModels("qwen", deps(GPU));
  assertEquals(r.offline, false);
  assertEquals(r.items.map((i) => i.card.id), ["u/big-GGUF", "u/mid-GGUF"]);
  assertEquals(r.items.map((i) => i.fit?.status), ["no_fit", "fits"]);
});

Deno.test("searchModels - same results on the no-GPU profile: nothing but tiny models fits", async () => {
  const r = await searchModels("qwen", deps(NO_GPU));
  assertEquals(r.items.map((i) => i.fit?.status), ["no_fit", "no_fit"]);
});

Deno.test("searchModels - falls back to curated models when Hugging Face is unreachable", async () => {
  const r = await searchModels("", deps(GPU, false));
  assertEquals(r.offline, true);
  assertEquals(r.items.length > 0, true);
  assertEquals(r.items.every((i) => i.card.capabilities.tools), true);
});

Deno.test("getModelDetail - lists quantizations with fit and the recommended one", async () => {
  const d = await getModelDetail("u/mid-GGUF", deps(GPU));
  assertEquals(d.quantizations.map((q) => q.quant.name), ["Q2_K", "Q4_K_M"]);
  assertEquals(d.bestQuantization, "Q4_K_M");
  assertEquals(d.readmeSummary.startsWith("A model for local agents"), true);
});

Deno.test("buildHardwareReport - GPU profile has a tool model that fits, no cloud suggestion needed", async () => {
  const r = await buildHardwareReport(deps(GPU, false), [], () => Promise.resolve([]));
  assertEquals(r.noToolModelFits, false);
  assertEquals(r.cloudSuggestion, null);
});

Deno.test("buildHardwareReport - no tool model fits: suggests a cloud model that supports tools", async () => {
  const groups = [{
    keyId: "k1",
    alias: "work",
    provider: "anthropic" as const,
    models: [
      { name: "embed", capabilities: [], toolSupport: { status: "unsupported" as const } },
      { name: "claude-sonnet-5-5", capabilities: [], toolSupport: { status: "supported" as const } },
    ],
  }];
  const r = await buildHardwareReport(deps(NO_GPU, false), [], () => Promise.resolve(groups));
  assertEquals(r.noToolModelFits, true);
  assertEquals(r.cloudSuggestion?.model, "claude-sonnet-5-5");
  assertEquals(r.hasCloudKey, true);
});

Deno.test("buildHardwareReport - no tool model fits and no API key: no suggestion, hasCloudKey false", async () => {
  const r = await buildHardwareReport(deps(NO_GPU, false), [], () => Promise.resolve([]));
  assertEquals(r.noToolModelFits, true);
  assertEquals(r.cloudSuggestion, null);
  assertEquals(r.hasCloudKey, false);
});

Deno.test("pickCloudSuggestion - ignores keys with no tool-capable model", () => {
  assertEquals(pickCloudSuggestion([{ keyId: "k", alias: "a", provider: "google", models: [] }]), null);
});

function pagedFetch(pages: unknown[][], seen: string[] = []): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = new URL(String(input));
    seen.push(url.search);
    const index = Number(url.searchParams.get("cursor") ?? 0);
    const headers: Record<string, string> = {};
    if (index + 1 < pages.length) {
      const next = new URL(url);
      next.searchParams.set("cursor", String(index + 1));
      headers.link = `<${next}>; rel="next"`;
    }
    return Promise.resolve(Response.json(pages[index], { headers }));
  }) as typeof fetch;
}

const repo = (id: string, params: number, tools: boolean, pipeline?: string) => ({
  id,
  pipeline_tag: pipeline,
  gguf: { total: params * 1e9, context_length: 8192, chat_template: tools ? "tools" : "plain" },
});

const pagedDeps = (
  pages: unknown[][],
  seen: string[] = [],
  profile: HardwareProfile = NO_GPU,
): DiscoveryDeps => ({
  hf: new HfClient(pagedFetch(pages, seen)),
  profile: () => Promise.resolve(profile),
  fitContext: () => Promise.resolve(CTX),
});

Deno.test("HfClient.search - exposes the next cursor and sends sort and cursor", async () => {
  const seen: string[] = [];
  const hf = new HfClient(pagedFetch([[repo("a/x", 1, true)], [repo("a/y", 1, true)]], seen));
  const first = await hf.search("q", { sort: "likes" });
  assertEquals(first.nextCursor, "1");
  const second = await hf.search("q", { sort: "likes", cursor: first.nextCursor! });
  assertEquals(second.nextCursor, null);
  assertEquals(seen[0].includes("sort=likes"), true);
  assertEquals(seen[1].includes("cursor=1"), true);
});

Deno.test("searchModels - keeps reading upstream pages until the filter yields a full page", async () => {
  const noTools = Array.from({ length: 5 }, (_, i) => repo(`a/plain${i}`, 1, false));
  const withTools = Array.from({ length: 5 }, (_, i) => repo(`a/tool${i}`, 1, true));
  const more = Array.from({ length: 5 }, (_, i) => repo(`a/more${i}`, 1, true));
  const r = await searchModels(
    "x",
    pagedDeps([noTools, withTools, more]),
    { sort: "downloads", filters: { tools: true } },
  );
  assertEquals(r.items.length, 10);
  assertEquals(r.items.every((i) => i.card.capabilities.tools), true);
  assertEquals(r.nextCursor, null);
});

Deno.test("searchModels - stops after the upstream page budget and returns a resumable cursor", async () => {
  const page = (n: number) => [repo(`a/p${n}`, 1, false)];
  const r = await searchModels(
    "x",
    pagedDeps(Array.from({ length: 8 }, (_, n) => page(n))),
    { filters: { tools: true } },
  );
  assertEquals(r.items.length, 0);
  assertEquals(r.nextCursor, "4");
});

Deno.test("searchModels - fitsOnly drops models that do not fit, and duplicates are removed", async () => {
  const r = await searchModels(
    "x",
    pagedDeps(
      [[repo("a/tiny", 0.6, true), repo("a/tiny", 0.6, true), repo("a/huge", 70, true)]],
      [],
      GPU,
    ),
    { filters: { fitsOnly: true } },
  );
  assertEquals(r.items.map((i) => i.card.id), ["a/tiny"]);
});

Deno.test("searchModels - vision filter uses the pipeline tag", async () => {
  const vlm = { ...repo("a/vlm", 1, true), pipeline_tag: "image-text-to-text" };
  const r = await searchModels("x", pagedDeps([[vlm, repo("a/text", 1, true)]]), {
    filters: { vision: true },
  });
  assertEquals(r.items.map((i) => i.card.id), ["a/vlm"]);
});

Deno.test("searchModels - offline fallback has no cursor and respects filters", async () => {
  const r = await searchModels("", deps(GPU, false), { filters: { vision: true } });
  assertEquals(r.offline, true);
  assertEquals(r.nextCursor, null);
  assertEquals(r.items.length, 0);
});

Deno.test("searchModels - Recommended adds live tool-capable models that fit, after the curated ones", async () => {
  const live = [
    { ...repo("unsloth/New-1B-GGUF", 1, true), downloads: 900 },
    { ...repo("unsloth/NoTools-1B-GGUF", 1, false), downloads: 5000 },
    { ...repo("unsloth/Huge-70B-GGUF", 70, true), downloads: 8000 },
  ];
  const fetchFn = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("author=unsloth")) return Promise.resolve(Response.json(live));
    if (url.includes("author=")) return Promise.resolve(Response.json([]));
    const curated = /api\/models\/(unsloth\/Qwen3-4B-GGUF)\?/.exec(url);
    if (curated) return Promise.resolve(Response.json(repo(curated[1], 4, true)));
    return Promise.resolve(new Response("", { status: 404 }));
  }) as typeof fetch;
  const r = await searchModels("", {
    hf: new HfClient(fetchFn),
    profile: () => Promise.resolve(GPU),
    fitContext: () => Promise.resolve(CTX),
  });
  assertEquals(r.items.map((i) => i.card.id), ["unsloth/Qwen3-4B-GGUF", "unsloth/New-1B-GGUF"]);
  assertEquals(r.nextCursor, null);
});
