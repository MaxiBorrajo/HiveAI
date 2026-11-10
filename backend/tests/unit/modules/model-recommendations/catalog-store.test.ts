import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { findEntry, loadCatalog, mergeCatalog } from "../../../../modules/model-recommendations/lib/catalog-store.ts";
import { DEFAULT_CATALOG } from "../../../../modules/model-recommendations/lib/default-catalog.ts";

Deno.test("loadCatalog - missing file gives the built-in catalog", async () => {
  const dir = await Deno.makeTempDir();
  const r = await loadCatalog(join(dir, "nope.json"));
  assertEquals(r.customized, false);
  assertEquals(r.catalog, DEFAULT_CATALOG);
});

Deno.test("loadCatalog - invalid JSON falls back to defaults", async () => {
  const dir = await Deno.makeTempDir();
  const path = join(dir, "model-catalog.json");
  await Deno.writeTextFile(path, "{ not json");
  assertEquals((await loadCatalog(path)).catalog, DEFAULT_CATALOG);
});

Deno.test("loadCatalog - a user file overrides an entry and adds new ones, no code change", async () => {
  const dir = await Deno.makeTempDir();
  const path = join(dir, "model-catalog.json");
  await Deno.writeTextFile(path, JSON.stringify({
    entries: [
      { provider: "ollama", match: "qwen3", tasks: { chat: { score: 0.1, reason: "mine" } } },
      { provider: "ollama", match: "my-model", tasks: { code: { score: 0.9, reason: "custom" } } },
    ],
  }));
  const { catalog, customized } = await loadCatalog(path);
  assertEquals(customized, true);
  assertEquals(findEntry(catalog, "ollama", "qwen3:8b")?.tasks.chat?.score, 0.1);
  assertEquals(findEntry(catalog, "ollama", "my-model:1b")?.tasks.code?.reason, "custom");
  assertEquals(catalog.entries.length, DEFAULT_CATALOG.entries.length + 1);
});

Deno.test("mergeCatalog - malformed entries and scores are ignored, the rest still applies", () => {
  const merged = mergeCatalog(DEFAULT_CATALOG, {
    entries: [
      "junk",
      { provider: "nope", match: "x", tasks: {} },
      { provider: "ollama", match: "ok", tasks: { chat: { score: 5, reason: "out of range" }, code: { score: 0.5, reason: "fine" } } },
    ],
    evalMapping: { chat: ["generation"], code: "bad" },
  });
  const ok = findEntry(merged, "ollama", "ok")!;
  assertEquals(Object.keys(ok.tasks), ["code"]);
  assertEquals(merged.evalMapping.chat, ["generation"]);
  assertEquals(merged.evalMapping.code, undefined);
});

Deno.test("findEntry - the longest matching prefix wins", () => {
  assertEquals(findEntry(DEFAULT_CATALOG, "google", "gemini-2.5-flash-lite-001")?.match, "gemini-2.5-flash-lite");
  assertEquals(findEntry(DEFAULT_CATALOG, "google", "gemini-2.5-flash-001")?.match, "gemini-2.5-flash");
  assertEquals(findEntry(DEFAULT_CATALOG, "ollama", "llama3.2-vision:11b")?.match, "llama3.2-vision");
});
