import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | null = null;

export function getDb(dataDir: string): DatabaseSync {
  if (db) return db;

  const dbDir = join(dataDir, "memory");
  mkdirSync(dbDir, { recursive: true });
  db = new DatabaseSync(join(dbDir, "hiveai.db"));

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      messageCount INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chatId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      vector TEXT NOT NULL,
      metadata TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content, id UNINDEXED
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chatId ON messages(chatId);
  `);

  return db;
}
