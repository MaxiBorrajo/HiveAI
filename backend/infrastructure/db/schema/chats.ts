import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { executionHistory, executions } from "./executions.ts";

export const chats = sqliteTable("chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  messageCount: integer("messageCount").notNull().default(0),
  /**
   * Set for chats that belong to a run comparison (the judge conversation):
   * they are not listed with the user's chats and are found again by
   * (executionId, chat_compared_runs).
   */
  executionId: integer("executionId").references(() => executions.id, {
    onDelete: "cascade",
  }),
}, (t) => [index("chats_execution_idx").on(t.executionId)]);

/** The runs a judge chat compares: one row per run (1NF, no "12,15" lists). */
export const chatComparedRuns = sqliteTable(
  "chat_compared_runs",
  {
    chatId: integer("chatId")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    historyId: integer("historyId")
      .notNull()
      .references(() => executionHistory.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.historyId] })],
);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatComparedRun = typeof chatComparedRuns.$inferSelect;
