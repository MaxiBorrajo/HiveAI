import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { chats } from "./chats.ts";
import { messages } from "./messages.ts";
import { executionHistory, executions } from "./executions.ts";

export const USAGE_CONTEXT_KINDS = [
  "chat",
  "execution",
  "graph_generation",
  "other",
] as const;
export type UsageContextKind = (typeof USAGE_CONTEXT_KINDS)[number];

export const USAGE_LOCATIONS = ["local", "cloud"] as const;
export type UsageLocation = (typeof USAGE_LOCATIONS)[number];

export const USAGE_ROLES = ["orchestrator", "delegate"] as const;
export type UsageRole = (typeof USAGE_ROLES)[number];

export const USAGE_STATUSES = ["ok", "error"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

// One row per model call. There are no foreign keys here on purpose: deleting
// an API key (or a chat) must not erase what was consumed, and the key alias is
// a snapshot taken at call time. Token columns are nullable and have no
// default: a provider that does not report a figure leaves it empty.
export const modelUsage = sqliteTable(
  "model_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: text("group_id").notNull(),
    contextKind: text("context_kind").$type<UsageContextKind>().notNull(),

    provider: text("provider").notNull(),
    model: text("model").notNull(),
    location: text("location").$type<UsageLocation>().notNull(),
    role: text("role").$type<UsageRole>().notNull(),

    keyId: text("key_id"),
    keyAlias: text("key_alias"),

    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    reasoningTokens: integer("reasoning_tokens"),

    durationMs: integer("duration_ms").notNull(),
    ttftMs: integer("ttft_ms"),

    status: text("status").$type<UsageStatus>().notNull(),
    errorType: text("error_type"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("model_usage_group_id_idx").on(t.groupId),
    index("model_usage_created_at_idx").on(t.createdAt),
    index("model_usage_key_id_idx").on(t.keyId),
    index("model_usage_provider_model_idx").on(t.provider, t.model),
  ],
);

const usageIdColumn = () =>
  integer("usage_id")
    .notNull()
    .references(() => modelUsage.id, { onDelete: "cascade" });

export const chatUsage = sqliteTable(
  "chat_usage",
  {
    usageId: usageIdColumn(),
    chatId: integer("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    messageId: integer("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("chat_usage_usage_id_idx").on(t.usageId),
    index("chat_usage_chat_id_idx").on(t.chatId),
    index("chat_usage_message_id_idx").on(t.messageId),
  ],
);

export const executionUsage = sqliteTable(
  "execution_usage",
  {
    usageId: usageIdColumn(),
    executionId: integer("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    historyId: integer("history_id").references(() => executionHistory.id, {
      onDelete: "set null",
    }),
    nodeId: text("node_id"),
  },
  (t) => [
    uniqueIndex("execution_usage_usage_id_idx").on(t.usageId),
    index("execution_usage_execution_id_idx").on(t.executionId),
    index("execution_usage_history_id_idx").on(t.historyId),
  ],
);

export const generationUsage = sqliteTable(
  "generation_usage",
  {
    usageId: usageIdColumn(),
    executionId: integer("execution_id").references(() => executions.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("generation_usage_usage_id_idx").on(t.usageId),
    index("generation_usage_execution_id_idx").on(t.executionId),
  ],
);

export type ModelUsage = typeof modelUsage.$inferSelect;
export type NewModelUsage = typeof modelUsage.$inferInsert;
