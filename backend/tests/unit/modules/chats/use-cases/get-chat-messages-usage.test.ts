import { assertEquals } from "@std/assert";
import { initORM } from "../../../../../infrastructure/db/orm.ts";
import { ChatRepository } from "../../../../../infrastructure/db/repositories/chat-repository.ts";
import { MessageRepository } from "../../../../../infrastructure/db/repositories/message-repository.ts";
import { ModelUsageRepository } from "../../../../../infrastructure/db/repositories/model-usage-repository.ts";
import { getChatMessages } from "../../../../../modules/chats/use-cases/get-chat-messages.ts";

function usageEntry(chatId: number, group: string, overrides = {}) {
  return {
    usage: {
      groupId: group,
      contextKind: "chat" as const,
      provider: "ollama",
      model: "llama3",
      location: "local" as const,
      role: "orchestrator" as const,
      keyId: null,
      keyAlias: null,
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      durationMs: 2_000,
      ttftMs: 500,
      status: "ok" as const,
      errorType: null,
      createdAt: Date.now(),
      ...overrides,
    },
    link: { kind: "chat" as const, chatId },
  };
}

Deno.test("getChatMessages - responses carry their usage and old ones carry null", async () => {
  const db = await initORM(await Deno.makeTempDir());
  const chats = new ChatRepository(db);
  const messages = new MessageRepository(db);
  const usage = new ModelUsageRepository(db);

  const chatId = await chats.create({
    title: "usage-view",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
  });
  const add = (role: string, content: string) =>
    messages.create({
      chatId,
      role,
      content,
      timestamp: Date.now(),
      metadata: null,
      vector: "[]",
    });

  const oldReply = await add("agent", "before the feature");
  await add("user", "question");
  const newReply = await add("agent", "after the feature");

  const group = crypto.randomUUID();
  await usage.record(usageEntry(chatId, group, { inputTokens: 100, outputTokens: 40 }));
  await usage.record(usageEntry(chatId, group, { inputTokens: 50, outputTokens: 10 }));
  await usage.record(
    usageEntry(chatId, crypto.randomUUID(), {
      provider: "anthropic",
      model: "claude-x",
      location: "cloud",
      keyAlias: "work",
      inputTokens: 900,
      outputTokens: 200,
    }),
  );
  await usage.attachMessage(group, newReply);

  const response = await getChatMessages(db, String(chatId), {});
  const { data } = await response.json();
  const byId = new Map<string, { usage: any }>(
    data.messages.map((m: { id: string; usage: unknown }) => [m.id, m]),
  );

  assertEquals(byId.get(String(oldReply))!.usage, null);
  const reply = byId.get(String(newReply))!.usage;
  assertEquals(reply.inputTokens, 150);
  assertEquals(reply.outputTokens, 50);
  assertEquals(reply.calls, 2);
  assertEquals(reply.models[0].location, "local");

  // The conversation counts every call, linked or not, per location.
  assertEquals(data.usage.local.inputTokens, 150);
  assertEquals(data.usage.cloud.inputTokens, 900);
  assertEquals(data.usage.cloud.models[0].keyAliases, ["work"]);
});
