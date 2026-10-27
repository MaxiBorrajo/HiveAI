import { assertEquals } from "@std/assert";
import { mapPullError } from "../../../../modules/downloads/lib/pull-errors.ts";
import { parseModelName } from "../../../../modules/downloads/lib/registry-size.ts";
import { fetchRegistryInfo } from "../../../../modules/downloads/lib/registry-size.ts";

Deno.test("mapPullError - classifies the common failures", () => {
  assertEquals(mapPullError(new Error("pull model manifest: file does not exist"), "x").kind, "not_found");
  assertEquals(mapPullError(new Error("write: no space left on device"), "x").kind, "disk_full");
  assertEquals(mapPullError(new Error("dial tcp: i/o timeout"), "x").kind, "network");
  assertEquals(mapPullError(new Error("fetch failed"), "x").kind, "ollama_down");
  assertEquals(mapPullError(new Error("boom"), "x").kind, "unknown");
});

Deno.test("parseModelName - validates and defaults namespace/tag", () => {
  assertEquals(parseModelName("gemma3n:e4b"), { repo: "library/gemma3n", tag: "e4b" });
  assertEquals(parseModelName("user/model"), { repo: "user/model", tag: "latest" });
  assertEquals(parseModelName("bad name!"), null);
  assertEquals(parseModelName(""), null);
});

Deno.test("fetchRegistryInfo - sums layer sizes, reports 404 as non-existent", async () => {
  const ok = await fetchRegistryInfo("m:1", () =>
    Promise.resolve(Response.json({ config: { size: 10 }, layers: [{ size: 100 }, { size: 200 }] })));
  assertEquals(ok, { exists: true, sizeBytes: 310 });
  const missing = await fetchRegistryInfo("m:1", () => Promise.resolve(new Response("", { status: 404 })));
  assertEquals(missing, { exists: false, sizeBytes: null });
  const offline = await fetchRegistryInfo("m:1", () => Promise.reject(new Error("offline")));
  assertEquals(offline, { exists: true, sizeBytes: null });
});

Deno.test("isModelInstalled - treats a bare name as :latest and ignores case", async () => {
  const { isModelInstalled } = await import("../../../../modules/downloads/lib/registry-size.ts");
  const installed = ["qwen3:8b", "lfm2.5-thinking:latest"];
  assertEquals(isModelInstalled("qwen3:8b", installed), true);
  assertEquals(isModelInstalled("Qwen3:8B", installed), true);
  assertEquals(isModelInstalled("lfm2.5-thinking", installed), true);
  assertEquals(isModelInstalled("qwen3", installed), false);
  assertEquals(isModelInstalled("qwen3:1.7b", installed), false);
});
