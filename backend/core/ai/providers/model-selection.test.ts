import { assertEquals } from "@std/assert";
import {
  describeCatalog,
  modelConfigFields,
  type ModelSelection,
  resolveNodeModel,
} from "./model-selection.ts";
import { splitContent } from "./capabilities.ts";

const selection: ModelSelection = {
  orchestrator: { provider: "anthropic", model: "claude-opus-5-5", keyId: "k1" },
  catalog: [
    { id: "anthropic:claude-opus-5-5", ref: { provider: "anthropic", model: "claude-opus-5-5", keyId: "k1" }, label: "", capabilities: ["tools", "thinking"] },
    { id: "ollama:qwen3:8b", ref: { provider: "ollama", model: "qwen3:8b" }, label: "8B local", capabilities: ["tools"] },
  ],
};

Deno.test("resolveNodeModel - valid proposal wins, unknown falls back to orchestrator", () => {
  assertEquals(resolveNodeModel("ollama:qwen3:8b", selection)?.model, "qwen3:8b");
  assertEquals(resolveNodeModel("made-up", selection)?.model, "claude-opus-5-5");
  assertEquals(resolveNodeModel(undefined, selection)?.provider, "anthropic");
  assertEquals(resolveNodeModel("x", undefined), undefined);
});

Deno.test("modelConfigFields - local nodes stay provider-less, cloud nodes carry provider and key", () => {
  assertEquals(modelConfigFields({ provider: "ollama", model: "qwen3:8b" }), { model: "qwen3:8b" });
  assertEquals(modelConfigFields(selection.orchestrator), {
    model: "claude-opus-5-5",
    provider: "anthropic",
    keyId: "k1",
  });
});

Deno.test("describeCatalog - lists every option id", () => {
  const text = describeCatalog(selection);
  assertEquals(text.includes("anthropic:claude-opus-5-5"), true);
  assertEquals(text.includes("ollama:qwen3:8b"), true);
});

Deno.test("splitContent - separates text and thinking blocks", () => {
  assertEquals(splitContent("hi"), { text: "hi", thinking: "" });
  assertEquals(
    splitContent([
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "answer" },
      { type: "tool_use", id: "1" },
    ]),
    { text: "answer", thinking: "hmm" },
  );
  assertEquals(splitContent(undefined), { text: "", thinking: "" });
});

Deno.test("describeCatalog - includes location, size and context when known", () => {
  const text = describeCatalog({
    ...selection,
    catalog: [
      { id: "ollama:qwen3:8b", ref: { provider: "ollama", model: "qwen3:8b" }, label: "8.2B local", capabilities: ["tools"], location: "local", contextLength: 40960 },
    ],
  });
  assertEquals(text, "- ollama:qwen3:8b — local, free, 8.2B local, ctx 41k [tools]");
});

Deno.test("describeCatalog - flags models whose tool support is unverified", () => {
  const text = describeCatalog({
    ...selection,
    catalog: [
      { id: "google:gemini-flash", ref: { provider: "google", model: "gemini-flash", keyId: "k" }, label: "", capabilities: [], toolSupport: { status: "unknown" } },
    ],
  });
  assertEquals(text.includes("[tools: unverified]"), true);
});

Deno.test("normalizeProviderError - a tools rejection becomes a clear tools_unsupported error", async () => {
  const { normalizeProviderError } = await import("./errors.ts");
  const e = normalizeProviderError(
    new Error("registry.ollama.ai/library/gemma3:latest does not support tools"),
    "ollama",
  );
  assertEquals(e.kind, "tools_unsupported");
  assertEquals(e.message.includes("does not support tool calling"), true);
});
