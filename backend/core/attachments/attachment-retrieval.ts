import { isImageMimeType } from "./attachment-limits.ts";
import { MAX_CHUNKS_PER_FILE, type Embed } from "./attachment-index.ts";
import { cosineSimilarity } from "../../infrastructure/db/repositories/message-repository.ts";
import type {
  Attachment,
  AttachmentRepository,
} from "../../infrastructure/db/repositories/attachment-repository.ts";

// Unrelated text of the same language scores surprisingly high: anything well
// below the best match is noise that buries it.
const MAX_SCORE_BEHIND_BEST = 0.1;
const MIN_SIMILARITY = 0.4;
const MIN_KEYWORD_OVERLAP = 0.5;
const MIN_KEYWORD_LENGTH = 4;

function keywordsOf(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= MIN_KEYWORD_LENGTH))];
}

// Embeddings miss exact identifiers such as an invoice number or a code.
function keywordOverlap(keywords: string[], text: string): number {
  if (keywords.length === 0) return 0;
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k)).length / keywords.length;
}

function isSearchable(row: Attachment): boolean {
  return row.messageId !== null && !isImageMimeType(row.mimeType);
}

export interface RetrievalRequest {
  repo: AttachmentRepository;
  chatId: number;
  query: string;
  embed: Embed;
  maxChars: number;
  /** Characters of each file this message already carries; Infinity if all. */
  sentChars: Map<number, number>;
}

export interface Retrieval {
  /** Text block for the model, when the chat has files beyond this message. */
  text?: string;
  warnings: string[];
}

export async function retrieveAttachmentExcerpts(
  { repo, chatId, query, embed, maxChars, sentChars }: RetrievalRequest,
): Promise<Retrieval> {
  const files = (await repo.findByChatId(chatId)).filter(isSearchable);
  const fileById = new Map(files.map((file) => [file.id, file]));
  const chunks = await repo.findChunks(files.map((file) => file.id));

  const warnings: string[] = [];
  for (const file of files) {
    if (sentChars.get(file.id) === Infinity) continue;
    if (file.indexedAt === null) {
      warnings.push(
        `'${file.originalName}' is still being prepared for search: the model can only look through the part that is ready.`,
      );
    } else if (
      sentChars.has(file.id) &&
      chunks.filter((c) => c.attachmentId === file.id).length >= MAX_CHUNKS_PER_FILE
    ) {
      warnings.push(
        `'${file.originalName}' is too long to search completely: the model can only look through its first ${MAX_CHUNKS_PER_FILE} parts.`,
      );
    }
  }

  const candidates = chunks.filter(
    (c) => c.startChar + c.text.length > (sentChars.get(c.attachmentId) ?? 0),
  );
  const excerpts: string[] = [];
  if (candidates.length > 0) {
    const queryVector = await embed(query);
    const keywords = keywordsOf(query);
    const ranked = candidates
      .map((chunk) => {
        const similarity = cosineSimilarity(queryVector, JSON.parse(chunk.vector));
        const overlap = keywordOverlap(keywords, chunk.text);
        return { chunk, similarity, overlap, score: similarity * 0.7 + overlap * 0.3 };
      })
      .filter((r) => r.similarity >= MIN_SIMILARITY || r.overlap >= MIN_KEYWORD_OVERLAP)
      .sort((a, b) => b.score - a.score);

    let usedChars = 0;
    for (const { chunk, score } of ranked) {
      if (score < ranked[0].score - MAX_SCORE_BEHIND_BEST) break;
      if (usedChars + chunk.text.length > maxChars) break;
      usedChars += chunk.text.length;
      excerpts.push(
        `[from '${fileById.get(chunk.attachmentId)!.originalName}']\n${chunk.text}`,
      );
    }
  }

  if (excerpts.length === 0) {
    const earlier = files.filter((file) => !sentChars.has(file.id));
    return { text: earlier.length ? noMatchNote(earlier) : undefined, warnings };
  }
  return {
    text: `--- Excerpts from files in this chat, selected for this message. They are partial: say so if the answer may be elsewhere in the file. ---\n${excerpts.join("\n\n")}`,
    warnings,
  };
}

function noMatchNote(files: Attachment[]): string {
  const names = files.map((file) => `'${file.originalName}'`).join(", ");
  return `[System note: files attached earlier in this chat: ${names}. Nothing in them matched this message closely.]`;
}
