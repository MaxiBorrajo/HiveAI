import { getDb } from "./db.ts";
import { cosineSimilarity } from "./similarity.ts";
import type { ChatStepMetadata, MessageRecord, MessageRole } from "./types.ts";

interface MessageRow {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  vector: string;
  metadata: string;
}

function toRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    vector: JSON.parse(row.vector) as number[],
    metadata: row.metadata ? (JSON.parse(row.metadata) as ChatStepMetadata) : null,
  };
}

// FTS5 treats bare text as query syntax. Quoting each individual word (and
// OR-ing them) matches messages containing ANY of the query's words, rather
// than requiring the exact phrase — the model's search query rarely repeats
// the original wording verbatim, so an exact-phrase match misses too often.
function toFtsMatchQuery(text: string): string {
  const words = text.match(/\p{L}+|\p{N}+/gu) ?? [];
  if (words.length === 0) return `""`;
  return words.map((w) => `"${w.replace(/"/g, '""')}"`).join(" OR ");
}

export function addMessage(
  dataDir: string,
  chatId: string,
  role: MessageRole,
  content: string,
  vector: number[],
  metadata: ChatStepMetadata | null = null,
): MessageRecord {
  const db = getDb(dataDir);

  const record: MessageRecord = {
    id: crypto.randomUUID(),
    chatId,
    role,
    content,
    timestamp: Date.now(),
    vector,
    metadata,
  };

  db.prepare(
    `INSERT INTO messages (id, chatId, role, content, timestamp, vector, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.chatId,
    record.role,
    record.content,
    record.timestamp,
    JSON.stringify(record.vector),
    metadata ? JSON.stringify(metadata) : "",
  );

  db.prepare(`INSERT INTO messages_fts (id, content) VALUES (?, ?)`).run(
    record.id,
    record.content,
  );

  return record;
}

export function getRecentMessages(
  dataDir: string,
  chatId: string,
  limit: number,
): MessageRecord[] {
  const db = getDb(dataDir);
  const rows = db
    .prepare(`SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(chatId, limit) as unknown as MessageRow[];

  return rows.map(toRecord).sort((a, b) => a.timestamp - b.timestamp);
}

export function getAllMessages(dataDir: string, chatId: string): MessageRecord[] {
  const db = getDb(dataDir);
  const rows = db
    .prepare(`SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp ASC`)
    .all(chatId) as unknown as MessageRow[];

  return rows.map(toRecord);
}

// A message that scores well is often a question whose answer lives in the
// very next message of the same chat (or the one right before it, if the
// match itself is the answer to a preceding question) — pulling in that
// neighbor lets the recalled snippet carry the actual fact, not just the
// question that mentions the topic.
function withAdjacentMessages(
  db: ReturnType<typeof getDb>,
  rows: MessageRow[],
): MessageRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const row of rows) {
    const neighbors = db
      .prepare(
        `SELECT * FROM messages WHERE chatId = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT 1`,
      )
      .all(row.chatId, row.timestamp) as unknown as MessageRow[];

    for (const neighbor of neighbors) {
      if (!byId.has(neighbor.id)) byId.set(neighbor.id, neighbor);
    }
  }

  return Array.from(byId.values());
}

function rankByHybridScore(
  db: ReturnType<typeof getDb>,
  candidates: MessageRow[],
  matchedIds: Set<string>,
  queryVector: number[],
  k: number,
): MessageRecord[] {
  const scored = candidates.map((row) => {
    const vector = JSON.parse(row.vector) as number[];
    const cosine = cosineSimilarity(queryVector, vector);
    const textBonus = matchedIds.has(row.id) ? 1 : 0;
    return { row, score: cosine + textBonus };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, k).map(({ row }) => row);
  const withNeighbors = withAdjacentMessages(db, top).sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  return withNeighbors.map(toRecord);
}

export function hybridSearchInChat(
  dataDir: string,
  chatId: string,
  queryText: string,
  queryVector: number[],
  k: number,
): MessageRecord[] {
  const db = getDb(dataDir);

  const candidates = db
    .prepare(`SELECT * FROM messages WHERE chatId = ?`)
    .all(chatId) as unknown as MessageRow[];

  const matchedIds = new Set(
    (
      db
        .prepare(
          `SELECT id FROM messages_fts WHERE content MATCH ? AND id IN (SELECT id FROM messages WHERE chatId = ?)`,
        )
        .all(toFtsMatchQuery(queryText), chatId) as unknown as { id: string }[]
    ).map((row) => row.id),
  );

  return rankByHybridScore(db, candidates, matchedIds, queryVector, k);
}

export function hybridSearchGlobal(
  dataDir: string,
  queryText: string,
  queryVector: number[],
  k: number,
  excludeChatId?: string,
): MessageRecord[] {
  const db = getDb(dataDir);

  const candidates = (
    excludeChatId
      ? db.prepare(`SELECT * FROM messages WHERE chatId != ?`).all(excludeChatId)
      : db.prepare(`SELECT * FROM messages`).all()
  ) as unknown as MessageRow[];

  const matchedIds = new Set(
    (
      db
        .prepare(`SELECT id FROM messages_fts WHERE content MATCH ?`)
        .all(toFtsMatchQuery(queryText)) as unknown as { id: string }[]
    ).map((row) => row.id),
  );

  return rankByHybridScore(db, candidates, matchedIds, queryVector, k);
}
