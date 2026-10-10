import { assertEquals } from "@std/assert";
import { walk } from "@std/fs/walk";
import { dirname, fromFileUrl, relative, join } from "@std/path";

const BACKEND = join(dirname(fromFileUrl(import.meta.url)), "../../../../..");

// Chat models must be built by createChatModel: that is where the usage
// callback is attached. Anything that builds one elsewhere is not recorded.
const ALLOWED = [
  // The factory itself and the provider adapters it delegates to.
  "core/ai/providers/create-chat-model.ts",
  "core/ai/providers/adapters/",
  // Offline routing experiments, not part of the app.
  "experiments/",
  // Tests may build real classes to assert on them.
  "tests/",
  "core/ai/providers/create-chat-model.test.ts",
  "core/ai/providers/list-cloud-models.test.ts",
];

const DIRECT_MODEL = /new\s+Chat(Ollama|Anthropic|GoogleGenerativeAI|OpenAI|Groq|Mistral\w*|Bedrock\w*)\s*\(/;

Deno.test("guard - no chat model is instantiated outside the model factory", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(BACKEND, {
      exts: [".ts"],
      skip: [/node_modules/, /[\\/]\.git[\\/]/],
    })
  ) {
    const path = relative(BACKEND, entry.path).replaceAll("\\", "/");
    if (ALLOWED.some((a) => path.startsWith(a))) continue;
    const lines = (await Deno.readTextFile(entry.path)).split("\n");
    lines.forEach((line, i) => {
      if (DIRECT_MODEL.test(line)) offenders.push(`${path}:${i + 1}`);
    });
  }
  assertEquals(
    offenders,
    [],
    "Build chat models with createChatModel() so their usage is recorded.",
  );
});
