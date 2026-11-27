import { assertEquals } from "@std/assert";
import { checkOllama } from "../../../core/ollama/ollama-status.ts";
import { beginModelActivity, isModelInUse } from "../../../core/ai/activity-tracker.ts";

Deno.test("checkOllama - ok / not_running / not_installed", async () => {
  assertEquals((await checkOllama({ ping: async () => true, installed: async () => true })).status, "ok");
  const down = await checkOllama({ ping: async () => false, installed: async () => true });
  assertEquals(down.status, "not_running");
  const missing = await checkOllama({ ping: async () => false, installed: async () => false });
  assertEquals(missing.status, "not_installed");
  assertEquals(missing.message?.includes("ollama.com"), true);
});

Deno.test("activity tracker - counts concurrent uses and ends idempotently", () => {
  const a = beginModelActivity("m");
  const b = beginModelActivity("m");
  assertEquals(isModelInUse("m"), true);
  a();
  a();
  assertEquals(isModelInUse("m"), true);
  b();
  assertEquals(isModelInUse("m"), false);
});
