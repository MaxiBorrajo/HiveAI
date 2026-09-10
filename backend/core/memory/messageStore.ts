import { getMessagesTable } from "./db.ts";
import type { ChatStepMetadata, MessageRecord, MessageRole } from "./types.ts";

interface MessageRow {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  vector: number[];
  metadata: string;
  _distance?: number;
  _relevance_score?: number;
}

function toRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    vector: row.vector,
    metadata: row.metadata ? (JSON.parse(row.metadata) as ChatStepMetadata) : null,
  };
}

export async function addMessage(
  dataDir: string,
  chatId: string,
  role: MessageRole,
  content: string,
  vector: number[],
  metadata: ChatStepMetadata | null = null,
): Promise<MessageRecord> {
  const table = await getMessagesTable(dataDir);

  const record: MessageRecord = {
    id: crypto.randomUUID(),
    chatId,
    role,
    content,
    timestamp: Date.now(),
    vector,
    metadata,
  };

  await table.add([
    {
      ...record,
      metadata: metadata ? JSON.stringify(metadata) : "",
    },
  ]);

  return record;
}

export async function getRecentMessages(
  dataDir: string,
  chatId: string,
  limit: number,
): Promise<MessageRecord[]> {
  const table = await getMessagesTable(dataDir);
  const rows = (await table
    .query()
    .where(`chatId = '${chatId}'`)
    .toArray()) as MessageRow[];

  return rows
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map(toRecord);
}

export async function getAllMessages(
  dataDir: string,
  chatId: string,
): Promise<MessageRecord[]> {
  const table = await getMessagesTable(dataDir);
  const rows = (await table
    .query()
    .where(`chatId = '${chatId}'`)
    .toArray()) as MessageRow[];

  return rows.sort((a, b) => a.timestamp - b.timestamp).map(toRecord);
}

export async function hybridSearchInChat(
  dataDir: string,
  chatId: string,
  queryText: string,
  queryVector: number[],
  k: number,
): Promise<MessageRecord[]> {
  const table = await getMessagesTable(dataDir);
  const rows = (await table
    .query()
    .nearestTo(queryVector)
    .fullTextSearch(queryText)
    .where(`chatId = '${chatId}'`)
    .limit(k)
    .toArray()) as MessageRow[];

  return rows.map(toRecord);
}

export async function hybridSearchGlobal(
  dataDir: string,
  queryText: string,
  queryVector: number[],
  k: number,
  excludeChatId?: string,
): Promise<MessageRecord[]> {
  const table = await getMessagesTable(dataDir);
  let query = table.query().nearestTo(queryVector).fullTextSearch(queryText);

  if (excludeChatId) {
    query = query.where(`chatId != '${excludeChatId}'`);
  }

  const rows = (await query.limit(k).toArray()) as MessageRow[];
  return rows.map(toRecord);
}
