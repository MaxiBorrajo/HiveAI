import { getDb } from "./db.ts";
import type { ChatRecord } from "./types.ts";

export function createChat(dataDir: string, title: string): ChatRecord {
  const db = getDb(dataDir);
  const now = Date.now();

  const chat: ChatRecord = {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };

  db.prepare(
    `INSERT INTO chats (id, title, createdAt, updatedAt, messageCount) VALUES (?, ?, ?, ?, ?)`,
  ).run(chat.id, chat.title, chat.createdAt, chat.updatedAt, chat.messageCount);

  return chat;
}

export function listChats(dataDir: string): ChatRecord[] {
  const db = getDb(dataDir);
  const rows = db
    .prepare(`SELECT * FROM chats ORDER BY updatedAt DESC`)
    .all() as unknown as ChatRecord[];

  return rows;
}

export function getChat(dataDir: string, chatId: string): ChatRecord | null {
  const db = getDb(dataDir);
  const row = db
    .prepare(`SELECT * FROM chats WHERE id = ?`)
    .get(chatId) as unknown as ChatRecord | undefined;

  return row ?? null;
}

export function touchChat(dataDir: string, chatId: string): void {
  const db = getDb(dataDir);
  const chat = getChat(dataDir, chatId);
  if (!chat) return;

  db.prepare(
    `UPDATE chats SET updatedAt = ?, messageCount = ? WHERE id = ?`,
  ).run(Date.now(), chat.messageCount + 1, chatId);
}

export function deleteChat(dataDir: string, chatId: string): void {
  const db = getDb(dataDir);
  db.prepare(`DELETE FROM chats WHERE id = ?`).run(chatId);
  db.prepare(
    `DELETE FROM messages_fts WHERE id IN (SELECT id FROM messages WHERE chatId = ?)`,
  ).run(chatId);
  db.prepare(`DELETE FROM messages WHERE chatId = ?`).run(chatId);
}
