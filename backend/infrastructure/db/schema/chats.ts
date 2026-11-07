import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { executions } from "./executions.ts";

export const chats = sqliteTable("chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  messageCount: integer("messageCount").notNull().default(0),
  /**
   * Set for chats that belong to a run comparison (the judge conversation):
   * they are not listed with the user's chats and are found again by
   * (executionId, runKey).
   */
  executionId: integer("executionId").references(() => executions.id, {
    onDelete: "cascade",
  }),
  /** Sorted history ids of the compared runs, e.g. "12,15". */
  runKey: text("runKey"),
}, (t) => [index("chats_execution_run_idx").on(t.executionId, t.runKey)]);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
