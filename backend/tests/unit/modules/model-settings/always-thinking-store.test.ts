import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  readAlwaysThinkingModels,
  rememberAlwaysThinking,
} from "../../../../modules/model-settings/lib/always-thinking-store.ts";

async function tempStore() {
  return join(await Deno.makeTempDir(), "models-that-always-think.json");
}

Deno.test("always-thinking store - empty until a model is recorded", async () => {
  assertEquals(await readAlwaysThinkingModels(await tempStore()), []);
});

Deno.test("always-thinking store - records a model once and keeps it on disk", async () => {
  const path = await tempStore();
  assertEquals(await rememberAlwaysThinking("lfm2.5:latest", path), true);
  assertEquals(await rememberAlwaysThinking("lfm2.5:latest", path), false);
  assertEquals(await rememberAlwaysThinking("gpt-oss:20b", path), true);
  assertEquals(await readAlwaysThinkingModels(path), ["gpt-oss:20b", "lfm2.5:latest"]);
});

Deno.test("always-thinking store - a damaged file reads as empty", async () => {
  const path = await tempStore();
  await Deno.writeTextFile(path, "{not json");
  assertEquals(await readAlwaysThinkingModels(path), []);
});
