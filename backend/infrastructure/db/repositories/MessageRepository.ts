import { eq, ne, asc, desc } from "drizzle-orm";
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { AppDatabase } from "../orm.ts";
import { messages, type Message, type NewMessage } from "../schema/messages.ts";
import { embedText } from "../../../core/memory/embeddings.ts";

export type MessageRecord = Message;
export type { NewMessage };

export const RECENCY_WINDOW = 10;
export const RELEVANCE_TOPK = 6;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toBaseMessage(record: MessageRecord): BaseMessage {
  return record.role === "user"
    ? new HumanMessage(record.content)
    : new AIMessage(record.content);
}

function sanitizeFtsQuery(query: string): string {
  const clean = query.replace(/"/g, '""');
  return `"${clean}"`;
}

export class MessageRepository {
  constructor(private db: AppDatabase) {}

  async findByChatId(chatId: number): Promise<MessageRecord[]> {
    return await this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.timestamp));
  }

  async create(msg: NewMessage): Promise<number> {
    const [result] = await this.db
      .insert(messages)
      .values(msg)
      .returning({ id: messages.id });
    return result.id;
  }

  async buildTurnContext(
    chatId: number,
    userText: string,
  ): Promise<BaseMessage[]> {
    const queryVector = await embedText(userText);

    const recent = await this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.timestamp))
      .limit(RECENCY_WINDOW);

    const recentIds = new Set(recent.map((r) => r.id));

    const ftsStmt = this.db.$client.prepare(`
      SELECT msgId, bm25(messages_fts) as score
      FROM messages_fts
      WHERE messages_fts MATCH ?
    `);

    let textMatches: Record<number, number> = {};
    try {
      const rows = ftsStmt.all(sanitizeFtsQuery(userText)) as {
        msgId: number;
        score: number;
      }[];
      for (const r of rows) {
        textMatches[r.msgId] = r.score;
      }
    } catch (_e) {
      // FTS syntax error fallback — ignore and proceed with vector-only
    }

    const allChatMsgs = await this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId));

    const scored = allChatMsgs
      .filter((m) => !recentIds.has(m.id))
      .map((m) => {
        const vec = JSON.parse(m.vector) as number[];
        const distance = 1 - cosineSimilarity(queryVector, vec);
        const textScore = textMatches[m.id] ?? 0;
        const combinedScore = distance * 0.7 + textScore * 0.3;
        return { msg: m, distance, combinedScore };
      });

    const relevant = scored
      .filter((s) => s.distance < 0.6 || textMatches[s.msg.id] !== undefined)
      .sort((a, b) => a.combinedScore - b.combinedScore)
      .slice(0, RELEVANCE_TOPK)
      .map((s) => s.msg);

    const mergedMap = new Map<number, MessageRecord>();
    for (const msg of [...recent, ...relevant]) {
      mergedMap.set(msg.id, msg);
    }

    const merged = Array.from(mergedMap.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    return merged.map(toBaseMessage);
  }

  async hybridSearchGlobal(
    query: string,
    limit: number,
    excludeChatId: number,
  ): Promise<MessageRecord[]> {
    const queryVector = await embedText(query);

    const ftsStmt = this.db.$client.prepare(`
      SELECT msgId, bm25(messages_fts) as score
      FROM messages_fts
      WHERE messages_fts MATCH ?
    `);

    let textMatches: Record<number, number> = {};
    try {
      const rows = ftsStmt.all(sanitizeFtsQuery(query)) as {
        msgId: number;
        score: number;
      }[];
      for (const r of rows) {
        textMatches[r.msgId] = r.score;
      }
    } catch (_e) {}

    const allMsgs = await this.db
      .select()
      .from(messages)
      .where(ne(messages.chatId, excludeChatId));

    const scored = allMsgs.map((m) => {
      const vec = JSON.parse(m.vector) as number[];
      const distance = 1 - cosineSimilarity(queryVector, vec);
      const textScore = textMatches[m.id] ?? 0;
      const combinedScore = distance * 0.7 + textScore * 0.3;
      return { msg: m, distance, combinedScore };
    });

    return scored
      .filter((s) => s.distance < 0.6 || textMatches[s.msg.id] !== undefined)
      .sort((a, b) => a.combinedScore - b.combinedScore)
      .slice(0, limit)
      .map((s) => s.msg)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}
