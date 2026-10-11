import { assertEquals } from "@std/assert";
import type { ModelOption } from "../../../core/ai/providers/model-selection.ts";
import type { ModelRef } from "../../../core/ai/providers/types.ts";
import type { ModelOptionGroup } from "./build-model-options.ts";
import { selectCatalog } from "./build-model-selection.ts";

const opt = (ref: ModelRef): ModelOption => ({
  id: `${ref.provider}:${ref.model}`,
  ref,
  label: "",
  capabilities: [],
});

const group = (id: string, provider: "ollama" | "anthropic", keyId: string | undefined, models: string[]): ModelOptionGroup => ({
  id,
  label: id,
  options: models.map((model) => opt({ provider, model, ...(keyId ? { keyId } : {}) })),
});

Deno.test("selectCatalog - local models plus one key per cloud provider, preferring the orchestrator's key", () => {
  const groups = [
    group("local", "ollama", undefined, ["qwen3:8b"]),
    group("k1", "anthropic", "k1", ["a1"]),
    group("k2", "anthropic", "k2", ["a2"]),
  ];
  const { catalog } = selectCatalog(groups, { provider: "anthropic", model: "a2", keyId: "k2" });
  assertEquals(catalog.map((o) => o.id), ["ollama:qwen3:8b", "anthropic:a2"]);
});

Deno.test("selectCatalog - defaults to the first key and caps models per provider", () => {
  const groups = [
    group("k1", "anthropic", "k1", Array.from({ length: 12 }, (_, i) => `m${i}`)),
    group("k2", "anthropic", "k2", ["other"]),
  ];
  const { catalog } = selectCatalog(groups, { provider: "ollama", model: "" });
  assertEquals(catalog.length, 8);
  assertEquals(catalog.every((o) => o.ref.keyId === "k1"), true);
});

Deno.test("selectCatalog - the chat model is always selectable, even if no list contains it", () => {
  const { catalog } = selectCatalog([], { provider: "anthropic", model: "x", keyId: "k" });
  assertEquals(catalog.map((o) => o.id), ["anthropic:x"]);
});

Deno.test("selectCatalog - a group that failed to list contributes nothing", () => {
  const failed: ModelOptionGroup = { id: "k1", label: "k1", error: "boom", options: [] };
  const { catalog } = selectCatalog([failed], { provider: "ollama", model: "" });
  assertEquals(catalog, []);
});

Deno.test("selectCatalog - models that cannot take tools never reach the generator", () => {
  const no = { status: "unsupported", reason: "no tools" } as const;
  const unknown = { status: "unknown", reason: "not reported" } as const;
  const groups: ModelOptionGroup[] = [
    {
      id: "local",
      label: "local",
      options: [
        { ...opt({ provider: "ollama", model: "gemma3" }), toolSupport: no },
        { ...opt({ provider: "ollama", model: "qwen3:8b" }), toolSupport: { status: "supported" } },
      ],
    },
    {
      id: "k1",
      label: "k1",
      options: [
        { ...opt({ provider: "google", model: "embedding-001", keyId: "k1" }), toolSupport: no },
        { ...opt({ provider: "google", model: "gemini-flash", keyId: "k1" }), toolSupport: unknown },
      ],
    },
  ];
  const { catalog } = selectCatalog(groups, { provider: "ollama", model: "qwen3:8b" });
  assertEquals(catalog.map((o) => o.id), ["ollama:qwen3:8b", "google:gemini-flash"]);
});
