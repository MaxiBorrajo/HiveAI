import { assertEquals } from "@std/assert";
import { findLocalModelUsage } from "../../../../modules/models/use-cases/find-model-usage.ts";
import { normalizeProviderError } from "../../../../core/ai/providers/errors.ts";

const config = (model: string, provider = "ollama") =>
  ({ get: (k: string) => (k === "model" ? model : k === "modelProvider" ? provider : undefined) }) as never;

const repo = (graphs: unknown[]) => ({ findLatestGraphs: () => Promise.resolve(graphs) }) as never;

Deno.test("findLocalModelUsage - finds the chat and strategies using a local model", async () => {
  const usage = await findLocalModelUsage(
    repo([
      { execution: { id: 1, name: "A" }, graph: { graph: { nodes: [
        { id: "n1", type: "llm", config: { model: "qwen3:8b" } },
        { id: "n2", type: "llm", config: { model: "other" } },
        { id: "n3", type: "llm", config: { model: "qwen3:8b", provider: "anthropic" } },
      ] } } },
      { execution: { id: 2, name: "B" }, graph: { graph: { nodes: [] } } },
    ]),
    config("qwen3:8b"),
    "qwen3:8b",
  );
  assertEquals(usage.chat, true);
  assertEquals(usage.executions, [{ id: 1, name: "A", nodeIds: ["n1"] }]);
});

Deno.test("findLocalModelUsage - unused model and cloud chat model", async () => {
  const usage = await findLocalModelUsage(repo([]), config("qwen3:8b", "anthropic"), "qwen3:8b");
  assertEquals(usage, { chat: false, executions: [] });
});

Deno.test("normalizeProviderError - deleted ollama model gives an actionable message", () => {
  const err = normalizeProviderError(Object.assign(new Error("model 'x:1' not found"), { status: 404 }), "ollama");
  assertEquals(err.kind, "model_unavailable");
});
