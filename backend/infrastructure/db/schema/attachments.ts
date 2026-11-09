import {
  integer,
  primaryKey,
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
  // Null until every chunk of the file is stored in attachment_chunks.
  indexedAt: integer("indexedAt"),
});

export const attachmentChunks = sqliteTable(
  "attachment_chunks",
  {
    attachmentId: integer("attachmentId")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunkIndex").notNull(),
    startChar: integer("startChar").notNull(),
    text: text("text").notNull(),
    vector: text("vector").notNull(),
  },
  (table) => [primaryKey({ columns: [table.attachmentId, table.chunkIndex] })],
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type AttachmentChunk = typeof attachmentChunks.$inferSelect;
