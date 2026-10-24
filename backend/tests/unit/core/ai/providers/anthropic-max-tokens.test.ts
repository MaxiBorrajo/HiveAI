import { assertEquals } from "@std/assert";
import { anthropicAdapter } from "../../../../../core/ai/providers/adapters/anthropic.ts";

const maxTokensFor = (model: string, maxTokens?: number) =>
  (anthropicAdapter.createModel(model, "key", { maxTokens }) as unknown as { maxTokens: number }).maxTokens;

Deno.test("anthropic adapter - models unknown to langchain still get a generous output limit", () => {
  assertEquals(maxTokensFor("claude-haiku-5-5"), 16384);
  assertEquals(maxTokensFor("claude-sonnet-5-5"), 16384);
});

Deno.test("anthropic adapter - an explicit maxTokens wins over the default", () => {
  assertEquals(maxTokensFor("claude-haiku-5-5", 2000), 2000);
});
