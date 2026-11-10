import { assert, assertEquals } from "@std/assert";
import { suggestModelsForTurn } from "../../../../../modules/chats/use-cases/suggest-models.ts";
import type {
  Recommendation,
  RecommendationResult,
  TaskType,
} from "../../../../../modules/model-recommendations/types.ts";
import type { HiveMicrokernel } from "../../../../../core/microkernel/hive-microkernel.ts";

const hive = {} as HiveMicrokernel;
const current = { provider: "ollama", model: "llama3.2:3b" } as const;

const rec = (provider: "ollama" | "anthropic", model: string): Recommendation => ({
  id: `${provider}:${model}`,
  ref: { provider, model },
  label: model,
  location: provider === "ollama" ? "local" : "cloud",
  reason: "because",
  basis: "capabilities+cost",
  score: 0.8,
});

const result = (over: Partial<RecommendationResult> = {}): RecommendationResult => ({
  task: "code",
  recommendations: [],
  notRecommended: [],
  noData: false,
  suggestions: [],
  unrated: 0,
  ...over,
});

const classifyAs = (task: TaskType | null) => () =>
  Promise.resolve(task ? { task, source: "heuristic" as const } : null);

const input = { text: "fix this bug", currentRef: current, hive };

Deno.test("suggests the top models when the current one is not among them", async () => {
  const s = await suggestModelsForTurn(input, {
    classify: classifyAs("code"),
    recommend: () => Promise.resolve(result({ recommendations: [rec("ollama", "qwen2.5-coder:7b"), rec("anthropic", "claude-sonnet-4-5")] })),
  });
  assertEquals(s?.task, "code");
  assertEquals(s?.taskLabel, "Code");
  assertEquals(s?.recommendations.map((r) => r.id), ["ollama:qwen2.5-coder:7b", "anthropic:claude-sonnet-4-5"]);
  assertEquals(s?.suggestions, []);
});

Deno.test("stays quiet when the model in use is already among the recommended", async () => {
  const s = await suggestModelsForTurn(input, {
    classify: classifyAs("code"),
    recommend: () => Promise.resolve(result({ recommendations: [rec("ollama", "qwen2.5-coder:7b"), rec("ollama", "llama3.2:3b")] })),
  });
  assertEquals(s, null);
});

Deno.test("nothing suitable available: passes on what to install or configure", async () => {
  const s = await suggestModelsForTurn(input, {
    classify: classifyAs("vision"),
    recommend: () => Promise.resolve(result({ task: "vision", suggestions: [{ kind: "install", model: "gemma3:4b", reason: "reads images" }] })),
  });
  assertEquals(s?.recommendations, []);
  assertEquals(s?.suggestions.length, 1);
});

Deno.test("no recommendations and no suggestions: nothing to show", async () => {
  assertEquals(
    await suggestModelsForTurn(input, { classify: classifyAs("code"), recommend: () => Promise.resolve(result()) }),
    null,
  );
});

Deno.test("no catalog data for the task: nothing to show", async () => {
  const s = await suggestModelsForTurn(input, {
    classify: classifyAs("code"),
    recommend: () => Promise.resolve(result({ noData: true, recommendations: [rec("ollama", "x")] })),
  });
  assertEquals(s, null);
});

Deno.test("task not recognised: recommendations are not even computed", async () => {
  let asked = false;
  const s = await suggestModelsForTurn(input, {
    classify: classifyAs(null),
    recommend: () => ((asked = true), Promise.resolve(result())),
  });
  assertEquals(s, null);
  assertEquals(asked, false);
});

Deno.test("a failure never propagates", async () => {
  const s = await suggestModelsForTurn(input, {
    classify: classifyAs("code"),
    recommend: () => Promise.reject(new Error("boom")),
  });
  assertEquals(s, null);
});

Deno.test("a slow recommendation is dropped after the timeout", async () => {
  const started = Date.now();
  const s = await suggestModelsForTurn(input, {
    classify: classifyAs("code"),
    recommend: () => new Promise<RecommendationResult>((resolve) => setTimeout(() => resolve(result({ recommendations: [rec("ollama", "x")] })), 500)),
    timeoutMs: 30,
  });
  assertEquals(s, null);
  assert(Date.now() - started < 400);
});
