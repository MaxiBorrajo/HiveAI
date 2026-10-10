import { assertEquals } from "@std/assert";
import { ChatAnthropic } from "@langchain/anthropic";
import { listCloudModels } from "./list-cloud-models.ts";
import { createChatModel } from "./create-chat-model.ts";
import {
  isThinkingRejection,
  markThinkingUnsupported,
  shouldRequestThinking,
} from "./thinking.ts";

const json = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

Deno.test("listCloudModels - anthropic ids and names", async () => {
  const models = await listCloudModels("anthropic", "k", () =>
    json({ data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }] }),
  );
  assertEquals(models, [
    { name: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", capabilities: ["tools"] },
  ]);
});

Deno.test("listCloudModels - google keeps only generateContent models and strips the prefix", async () => {
  const models = await listCloudModels("google", "k", () =>
    json({
      models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
      ],
    }),
  );
  assertEquals(models.map((m) => m.name), ["gemini-2.5-flash"]);
});

Deno.test("createChatModel - anthropic requests adaptive thinking when think is on", async () => {
  const m = (await createChatModel(
    { provider: "anthropic", model: "claude-sonnet-5-5", keyId: "k" },
    { think: true },
    () => Promise.resolve("sk"),
  )) as ChatAnthropic;
  // deno-lint-ignore no-explicit-any
  assertEquals((m as any).thinking, { type: "adaptive", display: "summarized" });
});

Deno.test("createChatModel - anthropic with think off sends no thinking", async () => {
  const m = (await createChatModel(
    { provider: "anthropic", model: "claude-old", keyId: "k" },
    { think: false },
    () => Promise.resolve("sk"),
  )) as ChatAnthropic;
  // deno-lint-ignore no-explicit-any
  assertEquals((m as any).thinking?.type, "disabled");
});

Deno.test("thinking fallback - recognises a thinking rejection and remembers the model", () => {
  assertEquals(
    isThinkingRejection({ status: 400, message: "thinking.type.adaptive is not supported for this model" }),
    true,
  );
  assertEquals(isThinkingRejection({ status: 400, message: "max_tokens too large" }), false);
  assertEquals(isThinkingRejection({ status: 401, message: "invalid x-api-key" }), false);

  const ref = { provider: "anthropic", model: "claude-haiku-x", keyId: "k" } as const;
  assertEquals(shouldRequestThinking(ref), true);
  markThinkingUnsupported(ref);
  assertEquals(shouldRequestThinking(ref), false);
});
