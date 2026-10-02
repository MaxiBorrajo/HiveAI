import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { chats } from "./chats.ts";

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chatId")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  timestamp: integer("timestamp").notNull(),
  metadata: text("metadata"),
  vector: text("vector").notNull(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
