import { DatabaseSync } from "node:sqlite";

export function initializeFts(db: DatabaseSync) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_chatId ON messages(chatId);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content, msgId UNINDEXED
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, msgId) VALUES (new.id, new.content, new.id);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE rowid = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      UPDATE messages_fts SET content = new.content WHERE rowid = old.id;
    END;
  `);
}
