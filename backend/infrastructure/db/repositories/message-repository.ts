import { eq, ne, and, lte, asc, desc } from "drizzle-orm";
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

export function cosineSimilarity(a: number[], b: number[]): number {
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

const MAX_TOOL_NOTES = 8;
const TOOL_NOTE_RESULT_CHARS = 120;

/**
 * Past turns are replayed as plain text, so the model would not know it ran
 * tools in them and could "correct" itself claiming it never did. The tools
 * used are stored in the message metadata: replay a short note about them.
 */
export function describeToolsUsed(metadata: string | null): string {
  if (!metadata) return "";
  try {
    const { steps } = JSON.parse(metadata) as {
      steps?: { node?: string; label?: string; summary?: string }[];
    };
    const notes = (steps ?? [])
      .filter((step) => step.node === "Executor" && step.label)
      .slice(0, MAX_TOOL_NOTES)
      .map((step) => {
        const result = (step.summary ?? "").slice(0, TOOL_NOTE_RESULT_CHARS);
        return result ? `${step.label} -> ${result}` : String(step.label);
      });
    return notes.length
      ? `\n\n[System note, not part of your reply: in this turn you really ran these tools: ${notes.join("; ")}]`
      : "";
  } catch {
    return "";
  }
}

export function toBaseMessage(record: MessageRecord): BaseMessage {
  return record.role === "user"
    ? new HumanMessage(record.content)
    : new AIMessage(record.content + describeToolsUsed(record.metadata));
}

function sanitizeFtsQuery(query: string): string {
  const clean = query.replace(/"/g, '""');
  return `"${clean}"`;
}

function scoreMessages(
  candidates: MessageRecord[],
  queryVector: number[],
  textMatches: Record<number, number>,
) {
  return candidates.map((msg) => {
    const vec = JSON.parse(msg.vector) as number[];
    const distance = 1 - cosineSimilarity(queryVector, vec);
    const textScore = textMatches[msg.id] ?? 0;
    const combinedScore = distance * 0.7 + textScore * 0.3;
    return { msg, distance, combinedScore };
  });
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

  async findUpToId(chatId: number, maxMessageId: number): Promise<MessageRecord[]> {
    return await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), lte(messages.id, maxMessageId)))
      .orderBy(asc(messages.id));
  }

  async create(msg: NewMessage): Promise<number> {
    const [result] = await this.db
      .insert(messages)
      .values(msg)
      .returning({ id: messages.id });
    return result.id;
  }

  private ftsScores(text: string): Record<number, number> {
    const scores: Record<number, number> = {};
    try {
      const rows = this.db.$client
        .prepare(
          `SELECT msgId, bm25(messages_fts) as score
           FROM messages_fts
           WHERE messages_fts MATCH ?`,
        )
        .all(sanitizeFtsQuery(text)) as { msgId: number; score: number }[];
      for (const r of rows) scores[r.msgId] = r.score;
    } catch {
    }
    return scores;
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

    const textMatches = this.ftsScores(userText);

    const allChatMsgs = await this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId));

    const scored = scoreMessages(
      allChatMsgs.filter((m) => !recentIds.has(m.id)),
      queryVector,
      textMatches,
    );

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

    const textMatches = this.ftsScores(query);

    const allMsgs = await this.db
      .select()
      .from(messages)
      .where(ne(messages.chatId, excludeChatId));

    const scored = scoreMessages(allMsgs, queryVector, textMatches);

    return scored
      .filter((s) => s.distance < 0.6 || textMatches[s.msg.id] !== undefined)
      .sort((a, b) => a.combinedScore - b.combinedScore)
      .slice(0, limit)
      .map((s) => s.msg)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}
