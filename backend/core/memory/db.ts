import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import * as lancedb from "@lancedb/lancedb";
import { EMBEDDING_DIMENSIONS } from "./embeddings.ts";

const CHATS_TABLE = "chats";
const MESSAGES_TABLE = "messages";

let connection: lancedb.Connection | null = null;
let chatsTable: lancedb.Table | null = null;
let messagesTable: lancedb.Table | null = null;

async function getConnection(dataDir: string): Promise<lancedb.Connection> {
  if (!connection) {
    const dbDir = join(dataDir, "memory", "lancedb");
    await mkdir(dbDir, { recursive: true });
    connection = await lancedb.connect(dbDir);
  }
  return connection;
}

export async function getChatsTable(dataDir: string): Promise<lancedb.Table> {
  if (chatsTable) return chatsTable;

  const db = await getConnection(dataDir);
  const existingTables = await db.tableNames();

  if (existingTables.includes(CHATS_TABLE)) {
    chatsTable = await db.openTable(CHATS_TABLE);
    return chatsTable;
  }

  chatsTable = await db.createTable(CHATS_TABLE, [
    {
      id: "__seed__",
      title: "",
      createdAt: 0,
      updatedAt: 0,
      messageCount: 0,
    },
  ]);
  await chatsTable.delete("id = '__seed__'");
  return chatsTable;
}

export async function getMessagesTable(dataDir: string): Promise<lancedb.Table> {
  if (messagesTable) return messagesTable;

  const db = await getConnection(dataDir);
  const existingTables = await db.tableNames();

  if (existingTables.includes(MESSAGES_TABLE)) {
    messagesTable = await db.openTable(MESSAGES_TABLE);
    return messagesTable;
  }

  messagesTable = await db.createTable(MESSAGES_TABLE, [
    {
      id: "__seed__",
      chatId: "__seed__",
      role: "user",
      content: "seed",
      timestamp: 0,
      vector: Array(EMBEDDING_DIMENSIONS).fill(0),
      metadata: "",
    },
  ]);
  await messagesTable.delete("id = '__seed__'");
  await messagesTable.createIndex("content", { config: lancedb.Index.fts() });
  return messagesTable;
}
