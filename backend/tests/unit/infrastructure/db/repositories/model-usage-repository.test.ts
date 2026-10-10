import { assertEquals } from "@std/assert";
import { initORM } from "../../../../../infrastructure/db/orm.ts";
import { ModelUsageRepository } from "../../../../../infrastructure/db/repositories/model-usage-repository.ts";
import { ChatRepository } from "../../../../../infrastructure/db/repositories/chat-repository.ts";
import { MessageRepository } from "../../../../../infrastructure/db/repositories/message-repository.ts";
import { ExecutionRepository } from "../../../../../infrastructure/db/repositories/execution-repository.ts";
import { ApiKeyRepository } from "../../../../../infrastructure/db/repositories/api-key-repository.ts";
import type { UsageEntry } from "../../../../../core/ai/usage/usage-recorder.ts";
import type { UsageFilters } from "../../../../../infrastructure/db/repositories/model-usage-repository.ts";

// initORM keeps one db per process: use unique group ids / models and only
// assert on the rows each test created.
async function setup() {
  const db = await initORM(await Deno.makeTempDir());
  return {
    db,
    usage: new ModelUsageRepository(db),
    chats: new ChatRepository(db),
    messages: new MessageRepository(db),
    executions: new ExecutionRepository(db),
    keys: new ApiKeyRepository(db),
  };
}

const NO_FILTER: UsageFilters = { limit: 500, offset: 0 };

function entry(
  overrides: Partial<UsageEntry["usage"]>,
  link: UsageEntry["link"],
): UsageEntry {
  return {
    usage: {
      groupId: "g",
      contextKind: "other",
      provider: "ollama",
      model: "m",
      location: "local",
      role: "orchestrator",
      keyId: null,
      keyAlias: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      durationMs: 10,
      ttftMs: null,
      status: "ok",
      errorType: null,
      createdAt: Date.now(),
      ...overrides,
    },
    link,
  };
}

Deno.test("ModelUsageRepository - chat calls link to the message once it exists", async () => {
  const { usage, chats, messages } = await setup();
  const chatId = await chats.create({
    title: "usage-chat",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
  });
  const group = crypto.randomUUID();
  const base = { groupId: group, contextKind: "chat" as const, model: "chat-m1" };
  await usage.record(entry({ ...base, inputTokens: 3 }, { kind: "chat", chatId }));
  await usage.record(entry({ ...base, inputTokens: 4 }, { kind: "chat", chatId }));

  let rows = await usage.list({ ...NO_FILTER, groupId: group });
  assertEquals(rows.length, 2);
  assertEquals(rows[0].context, { kind: "chat", chatId, messageId: null });

  const messageId = await messages.create({
    chatId,
    role: "agent",
    content: "hi",
    timestamp: 1,
    metadata: null,
    vector: "[]",
  });
  await usage.attachMessage(group, messageId);

  rows = await usage.list({ ...NO_FILTER, messageId });
  assertEquals(rows.length, 2);
  assertEquals(rows.map((r) => r.inputTokens).sort(), [3, 4]);
  assertEquals((await usage.list({ ...NO_FILTER, chatId })).length, 2);
});

Deno.test("ModelUsageRepository - execution calls link to the run and node", async () => {
  const { usage, executions } = await setup();
  const execution = await executions.create({
    name: "usage-exec",
    createdAt: 1,
    updatedAt: 1,
  });
  const group = crypto.randomUUID();
  const base = {
    groupId: group,
    contextKind: "execution" as const,
    role: "delegate" as const,
    model: "exec-m1",
  };
  await usage.record(
    entry(base, { kind: "execution", executionId: execution.id, nodeId: "n1" }),
  );
  await usage.record(
    entry(
      { ...base, status: "error", errorType: "rate_limit" },
      { kind: "execution", executionId: execution.id, nodeId: "n2" },
    ),
  );
  const history = await executions.createHistory({
    executionId: execution.id,
    iteration: 1,
    result: "{}",
    version: 1,
    createdAt: 1,
  });
  await usage.attachHistory(group, history.id);

  const byRun = await usage.list({ ...NO_FILTER, historyId: history.id });
  assertEquals(byRun.length, 2);
  assertEquals(byRun.map((r) => r.status).sort(), ["error", "ok"]);

  const byNode = await usage.list({
    ...NO_FILTER,
    executionId: execution.id,
    nodeId: "n2",
  });
  assertEquals(byNode.length, 1);
  assertEquals(byNode[0].errorType, "rate_limit");
  assertEquals(byNode[0].context, {
    kind: "execution",
    executionId: execution.id,
    historyId: history.id,
    nodeId: "n2",
  });
});

Deno.test("ModelUsageRepository - generation calls are found by execution and context", async () => {
  const { usage, executions } = await setup();
  const execution = await executions.create({
    name: "usage-gen",
    createdAt: 1,
    updatedAt: 1,
  });
  await usage.record(
    entry(
      { contextKind: "graph_generation", model: "gen-m1" },
      { kind: "graph_generation", executionId: execution.id },
    ),
  );
  const rows = await usage.list({
    ...NO_FILTER,
    executionId: execution.id,
    context: "graph_generation",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].context, {
    kind: "graph_generation",
    executionId: execution.id,
  });
});

Deno.test("ModelUsageRepository - deleting a key keeps the history with its frozen alias", async () => {
  const { usage, keys } = await setup();
  const key = await keys.create({
    id: crypto.randomUUID(),
    provider: "anthropic",
    alias: "personal",
    last4: "abcd",
    createdAt: 1,
    updatedAt: 1,
  });
  await usage.record(
    entry(
      {
        provider: "anthropic",
        model: "key-model-1",
        location: "cloud",
        keyId: key.id,
        keyAlias: "personal",
      },
      { kind: "other" },
    ),
  );
  await keys.update(key.id, { alias: "renamed" });
  await keys.delete(key.id);

  const rows = await usage.list({ ...NO_FILTER, keyId: key.id });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].keyAlias, "personal");
});

Deno.test("ModelUsageRepository - deleting a chat keeps the consumption", async () => {
  const { usage, chats } = await setup();
  const chatId = await chats.create({
    title: "to-delete",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
  });
  const group = crypto.randomUUID();
  await usage.record(
    entry(
      { groupId: group, contextKind: "chat", inputTokens: 9 },
      { kind: "chat", chatId },
    ),
  );
  await chats.delete(chatId);

  const rows = await usage.list({ ...NO_FILTER, groupId: group });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].inputTokens, 9);
  assertEquals(rows[0].context, { kind: "other" });
});

Deno.test("ModelUsageRepository.list - filters by model, location, status, dates and paginates", async () => {
  const { usage } = await setup();
  const model = `filter-${crypto.randomUUID()}`;
  for (let i = 0; i < 5; i++) {
    await usage.record(
      entry(
        {
          model,
          location: i % 2 === 0 ? "local" : "cloud",
          status: i === 4 ? "error" : "ok",
          createdAt: 1_000 + i,
        },
        { kind: "other" },
      ),
    );
  }
  const f = (extra: Partial<UsageFilters>) =>
    usage.list({ ...NO_FILTER, model, ...extra });

  assertEquals((await f({})).length, 5);
  assertEquals((await f({ location: "local" })).length, 3);
  assertEquals((await f({ status: "error" })).length, 1);
  assertEquals((await f({ from: 1_001, to: 1_003 })).length, 3);
  const page = await f({ limit: 2, offset: 1 });
  assertEquals(page.map((r) => r.createdAt), [1_003, 1_002]);
});
