import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { chats } from "./chats.ts";
import { messages } from "./messages.ts";
import { executions, executionHistory } from "./executions.ts";

export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chatId").references(() => chats.id, {
    onDelete: "cascade",
  }),
  messageId: integer("messageId").references(() => messages.id, {
    onDelete: "cascade",
  }),
  executionId: integer("executionId").references(
    (): AnySQLiteColumn => executions.id,
    { onDelete: "cascade" },
  ),
  executionHistoryId: integer("executionHistoryId").references(
    (): AnySQLiteColumn => executionHistory.id,
    { onDelete: "cascade" },
  ),
  direction: text("direction", { enum: ["input", "output"] }).notNull(),
  originalName: text("originalName").notNull(),
  mimeType: text("mimeType").notNull(),
  sizeBytes: integer("sizeBytes").notNull(),
  storagePath: text("storagePath").notNull(),
  extractedTextPath: text("extractedTextPath"),
  status: text("status", {
    enum: ["ready", "rejected_size", "rejected_type", "context_overflow"],
  })
    .notNull()
    .default("ready"),
  createdAt: integer("createdAt").notNull(),
});

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
