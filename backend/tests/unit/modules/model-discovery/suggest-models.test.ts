import { assert, assertEquals } from "@std/assert";
import {
  describePool,
  handleSuggest,
  MAX_SUGGESTIONS,
  resolvePicks,
  type SuggestDeps,
} from "../../../../modules/model-discovery/use-cases/suggest-models.ts";
import type { ModelCard, SearchResultItem } from "../../../../modules/model-discovery/types.ts";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";

const hive = {} as HiveMicrokernel;
const headers = { "content-type": "application/json" };

function item(id: string, over: Partial<ModelCard> = {}, fit: "fits" | "slow" | "no_fit" | null = "fits"): SearchResultItem {
  return {
    card: {
      source: "ollama",
      id,
      ollamaName: id,
      paramsBillions: 8,
      architecture: null,
      contextLength: 8192,
      downloads: 1,
      likes: 0,
      license: null,
      capabilities: { tools: true, vision: false, reasoning: false },
      ...over,
    },
    fit: fit ? { status: fit, reason: "r", requiredBytes: 1, usableContext: 8192 } : null,
    estimatedQ4Bytes: 1,
  };
}

const POOL = [item("qwen3"), item("llama3.2-vision", { capabilities: { tools: false, vision: true, reasoning: false } }), item("huge", {}, "no_fit")];
const body = { query: "algo para leer imágenes", model: { provider: "ollama", model: "qwen3:8b" } };

const run = async (b: unknown, deps: Partial<SuggestDeps>) => {
  const res = await handleSuggest(hive, b as never, headers, {
    pool: () => Promise.resolve(POOL),
    ask: () => Promise.resolve([]),
    ...deps,
  });
  return { status: res.status, json: await res.json() };
};

Deno.test("resolvePicks - keeps real models in order with their reason and fit", () => {
  const r = resolvePicks([{ name: "llama3.2-vision", reason: "reads images" }, { name: "qwen3", reason: "general" }], POOL);
  assertEquals(r.items.map((i) => i.card.id), ["llama3.2-vision", "qwen3"]);
  assertEquals(r.reasons["llama3.2-vision"], "reads images");
  assertEquals(r.items[0].fit?.status, "fits");
  assertEquals(r.message, undefined);
});

Deno.test("resolvePicks - invented names are dropped, tags and case are tolerated, duplicates collapse", () => {
  const r = resolvePicks(
    [{ name: "totally-made-up", reason: "x" }, { name: "Qwen3:8b", reason: "tag ok" }, { name: "qwen3", reason: "dup" }],
    POOL,
  );
  assertEquals(r.items.map((i) => i.card.id), ["qwen3"]);
  assertEquals(r.reasons.qwen3, "tag ok");
});

Deno.test("resolvePicks - nothing valid gives an explicit message, not a guess", () => {
  const r = resolvePicks([{ name: "nope", reason: "x" }], POOL);
  assertEquals(r.items, []);
  assert(r.message);
});

Deno.test("resolvePicks - never returns more than the maximum", () => {
  const pool = Array.from({ length: 12 }, (_, i) => item(`m${i}`));
  const r = resolvePicks(pool.map((p) => ({ name: p.card.id, reason: "r" })), pool);
  assertEquals(r.items.length, MAX_SUGGESTIONS);
});

Deno.test("describePool - tells the model what each candidate can do and whether it fits", () => {
  const text = describePool(POOL);
  assert(text.includes("- llama3.2-vision (8B; vision; on this PC: fits)"));
  assert(text.includes("- huge (8B; tools; on this PC: too big)"));
});

Deno.test("handleSuggest - returns the resolved list from the chosen model", async () => {
  const r = await run(body, { ask: () => Promise.resolve([{ name: "llama3.2-vision", reason: "reads images" }]) });
  assertEquals(r.status, 200);
  assertEquals(r.json.data.items.map((i: SearchResultItem) => i.card.id), ["llama3.2-vision"]);
});

Deno.test("handleSuggest - passes the chosen model and the pool to the asker", async () => {
  let seen: { provider: string; model: string; poolSize: number } | undefined;
  await run({ ...body, model: { provider: "anthropic", model: "claude-haiku-4-5", keyId: "k1" } }, {
    ask: (ref, _q, pool) => ((seen = { provider: ref.provider, model: ref.model, poolSize: pool.length }), Promise.resolve([])),
  });
  assertEquals(seen, { provider: "anthropic", model: "claude-haiku-4-5", poolSize: 3 });
});

Deno.test("handleSuggest - validates the request", async () => {
  assertEquals((await run({ ...body, query: "  " }, {})).status, 400);
  assertEquals((await run({ ...body, query: "x".repeat(501) }, {})).status, 400);
  assertEquals((await run({ query: "hola" }, {})).status, 400);
  assertEquals((await run({ query: "hola", model: { provider: "nope", model: "x" } }, {})).status, 400);
});

Deno.test("handleSuggest - a failing model or library is reported, not hidden", async () => {
  const asked = await run(body, { ask: () => Promise.reject(new Error("boom")) });
  assertEquals(asked.status, 502);
  assertEquals(asked.json.success, false);
  const noLibrary = await run(body, { pool: () => Promise.reject(new Error("offline")) });
  assertEquals(noLibrary.status, 502);
});

Deno.test("handleSuggest - an empty library says so", async () => {
  const r = await run(body, { pool: () => Promise.resolve([]) });
  assertEquals(r.status, 200);
  assertEquals(r.json.data.items, []);
  assert(r.json.data.message);
});
