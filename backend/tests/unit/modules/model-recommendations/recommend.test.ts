import { assert, assertEquals } from "@std/assert";
import { recommend, type RecommendInput } from "../../../../modules/model-recommendations/recommend.ts";
import { DEFAULT_CATALOG } from "../../../../modules/model-recommendations/lib/default-catalog.ts";
import type { Candidate } from "../../../../modules/model-recommendations/types.ts";
import type { HardwareProfile } from "../../../../modules/hardware/types.ts";

const GB = 1024 ** 3;
const hw16: HardwareProfile = {
  totalMemBytes: 16 * GB,
  availableMemBytes: 12 * GB,
  gpu: { usable: false, unifiedMemory: false },
};
const fitContext = { nCtx: 8192, pluginTokens: 0, kvCacheType: "f16" as const };

const local = (
  model: string,
  opts: Partial<Candidate> & { sizeGb?: number; params?: number } = {},
): Candidate => ({
  ref: { provider: "ollama", model },
  label: model,
  location: "local",
  vision: opts.vision ?? "unsupported",
  tools: opts.tools ?? "supported",
  local: { sizeBytes: (opts.sizeGb ?? 4.9) * GB, paramsBillions: opts.params ?? 8, contextLength: 32768 },
});
const cloud = (provider: "anthropic" | "google", model: string, tools: Candidate["tools"] = "supported"): Candidate => ({
  ref: { provider, model, keyId: "k1" },
  label: model,
  location: "cloud",
  vision: "unknown",
  tools,
});

const run = (task: RecommendInput["task"], candidates: Candidate[], extra: Partial<RecommendInput> = {}) =>
  recommend({ task, candidates, catalog: DEFAULT_CATALOG, hardware: hw16, fitContext, ...extra });

Deno.test("returns at most 3 recommendations, best first, with a reason each", () => {
  const r = run("chat", [
    local("qwen3:8b"),
    local("llama3.1:8b"),
    cloud("anthropic", "claude-sonnet-4-5"),
    cloud("anthropic", "claude-haiku-4-5"),
    cloud("google", "gemini-2.5-flash"),
  ]);
  assertEquals(r.recommendations.length, 3);
  for (const rec of r.recommendations) assert(rec.reason.length > 0);
  const scores = r.recommendations.map((x) => x.score);
  assertEquals(scores, [...scores].sort((a, b) => b - a));
});

Deno.test("local models that do not fit the hardware are not recommended, with the reason", () => {
  const r = run("chat", [local("qwen3:235b", { sizeGb: 140, params: 235 }), local("qwen3:8b")]);
  assertEquals(r.recommendations.map((x) => x.id), ["ollama:qwen3:8b"]);
  assertEquals(r.notRecommended.length, 1);
  assertEquals(r.notRecommended[0].id, "ollama:qwen3:235b");
  assert(r.notRecommended[0].reason.includes("Does not fit your hardware"));
});

Deno.test("vision requires declared vision support", () => {
  const r = run("vision", [
    local("qwen3:8b"), // no vision
    local("gemma3:4b", { vision: "supported", sizeGb: 3.3, params: 4 }),
    cloud("anthropic", "claude-sonnet-4-5"), // catalog declares vision
  ]);
  const ids = r.recommendations.map((x) => x.id);
  assert(ids.includes("ollama:gemma3:4b"));
  assert(ids.includes("anthropic:claude-sonnet-4-5"));
  assert(!ids.includes("ollama:qwen3:8b"));
  assertEquals(r.notRecommended.find((n) => n.id === "ollama:qwen3:8b")?.reason, "Does not support images.");
});

Deno.test("vision: a model whose support is unknown and not declared is excluded", () => {
  const r = run("vision", [cloud("google", "gemini-unlisted-model")]);
  assertEquals(r.recommendations.length, 0);
  assertEquals(r.notRecommended[0].reason, "Image support is not declared for this model.");
});

Deno.test("tools requires declared tool calling (unsupported and unknown are excluded)", () => {
  const r = run("tools", [
    local("qwen3:8b"),
    local("llama3.1:8b", { tools: "unsupported" }),
    local("deepseek-r1:8b", { tools: "unknown" }),
  ]);
  assertEquals(r.recommendations.map((x) => x.id), ["ollama:qwen3:8b"]);
  assertEquals(r.notRecommended.map((n) => n.id).sort(), ["ollama:deepseek-r1:8b", "ollama:llama3.1:8b"]);
});

Deno.test("models that are not available never appear", () => {
  // only an installed local model: no cloud model can show up
  const r = run("reasoning", [local("deepseek-r1:8b", { tools: "unsupported" })]);
  assertEquals(r.recommendations.map((x) => x.id), ["ollama:deepseek-r1:8b"]);
  assert(!r.recommendations.some((x) => x.location === "cloud"));
});

Deno.test("nothing suitable: suggests an installable local model that fits and a cloud provider", () => {
  const r = run("code", []);
  assertEquals(r.recommendations.length, 0);
  assertEquals(r.noData, false);
  const install = r.suggestions.find((s) => s.kind === "install");
  const configure = r.suggestions.find((s) => s.kind === "configure-cloud");
  assertEquals(install?.kind === "install" && install.model, "qwen2.5-coder:7b");
  assert(configure);
});

Deno.test("install suggestion skips models that do not fit the hardware", () => {
  const tiny: HardwareProfile = { ...hw16, availableMemBytes: 2 * GB };
  const r = run("vision", [], { hardware: tiny });
  assert(!r.suggestions.some((s) => s.kind === "install"));
});

Deno.test("no catalog data for the task: reports it instead of inventing a recommendation", () => {
  const empty = { ...DEFAULT_CATALOG, entries: DEFAULT_CATALOG.entries.map((e) => ({ ...e, tasks: { ...e.tasks, code: undefined } })) };
  const r = recommend({ task: "code", candidates: [local("qwen3:8b")], catalog: empty, hardware: hw16, fitContext });
  assertEquals(r.noData, true);
  assertEquals(r.recommendations.length, 0);
  assert(r.message);
});

Deno.test("available models unknown to the catalog are counted, not guessed", () => {
  const r = run("chat", [local("mystery-model:7b"), local("qwen3:8b")]);
  assertEquals(r.unrated, 1);
  assertEquals(r.recommendations.map((x) => x.id), ["ollama:qwen3:8b"]);
});

Deno.test("without evals the basis is capabilities and cost; with evals it says so", () => {
  const candidates = [local("qwen3:8b")];
  assertEquals(run("summarization", candidates).recommendations[0].basis, "capabilities+cost");
  const withEvals = run("summarization", candidates, {
    evals: { "ollama:qwen3:8b": { value: 1, lowConfidence: false } },
  });
  assertEquals(withEvals.recommendations[0].basis, "capabilities+cost+evals");
  assert(withEvals.recommendations[0].score > run("summarization", candidates).recommendations[0].score);
});

Deno.test("low-confidence evals are ignored", () => {
  const r = run("summarization", [local("qwen3:8b")], {
    evals: { "ollama:qwen3:8b": { value: 0, lowConfidence: true } },
  });
  assertEquals(r.recommendations[0].basis, "capabilities+cost");
});

Deno.test("cloud recommendations carry an estimated cost; local ones do not", () => {
  const r = run("chat", [local("qwen3:8b"), cloud("anthropic", "claude-sonnet-4-5")]);
  const c = r.recommendations.find((x) => x.location === "cloud")!;
  const l = r.recommendations.find((x) => x.location === "local")!;
  assert(typeof c.estimatedCostUsd === "number" && c.estimatedCostUsd > 0);
  assertEquals(l.estimatedCostUsd, undefined);
});

Deno.test("a cheap cloud model outranks an expensive one on a simple task", () => {
  const r = run("chat", [cloud("anthropic", "claude-opus-4-5"), cloud("google", "gemini-2.5-flash")]);
  assertEquals(r.recommendations[0].id, "google:gemini-2.5-flash");
});

Deno.test("no hardware info: local models are not filtered out", () => {
  const r = run("chat", [local("qwen3:235b", { sizeGb: 140, params: 235 })], { hardware: null });
  assertEquals(r.recommendations.length, 1);
});
