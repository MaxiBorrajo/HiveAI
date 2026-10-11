import { assertEquals } from "@std/assert";
import { resolveToolSupport, type ToolSupportLookup } from "./resolve-tool-support.ts";

const lookup: ToolSupportLookup = {
  localCapabilities: (model) =>
    Promise.resolve(
      model === "qwen3:8b"
        ? ["completion", "tools", "thinking"]
        : model === "gemma3:4b"
          ? ["completion", "vision"]
          : null,
    ),
  cloudSupport: ({ model }) =>
    Promise.resolve(
      model === "claude-sonnet-5-5"
        ? { status: "supported" as const }
        : model === "embedding-001"
          ? { status: "unsupported" as const, reason: "Not a chat model." }
          : undefined,
    ),
};

Deno.test("resolveToolSupport - local model with tools is supported", async () => {
  assertEquals((await resolveToolSupport({ provider: "ollama", model: "qwen3:8b" }, lookup)).status, "supported");
});

Deno.test("resolveToolSupport - gemma3 style local model without tools is unsupported", async () => {
  const s = await resolveToolSupport({ provider: "ollama", model: "gemma3:4b" }, lookup);
  assertEquals(s.status, "unsupported");
});

Deno.test("resolveToolSupport - Ollama unreachable is unknown, not a block", async () => {
  assertEquals((await resolveToolSupport({ provider: "ollama", model: "x" }, lookup)).status, "unknown");
});

Deno.test("resolveToolSupport - cloud chat model supported, non-chat unsupported, unlisted unknown", async () => {
  const ref = (model: string) => ({ provider: "google" as const, model, keyId: "k" });
  assertEquals((await resolveToolSupport({ ...ref("claude-sonnet-5-5"), provider: "anthropic" }, lookup)).status, "supported");
  assertEquals((await resolveToolSupport(ref("embedding-001"), lookup)).status, "unsupported");
  assertEquals((await resolveToolSupport(ref("nope"), lookup)).status, "unknown");
});
