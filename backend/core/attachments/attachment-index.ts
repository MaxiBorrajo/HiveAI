import { embedText } from "../memory/embeddings.ts";
import { attachmentText } from "./build-attachment-content.ts";
import type { AttachmentRepository } from "../../infrastructure/db/repositories/attachment-repository.ts";

const CHUNK_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 200;

// Embedding is slow on local hardware (around a second per chunk on a loaded
// machine), so this bounds how long one file can keep the queue busy.
export const MAX_CHUNKS_PER_FILE = 500;

export type Embed = (text: string) => Promise<number[]>;

export interface TextChunk {
  startChar: number;
  text: string;
}

function chunkEnd(text: string, start: number): number {
  const limit = start + CHUNK_CHARS;
  if (limit >= text.length) return text.length;
  const earliest = start + CHUNK_CHARS / 2;
  for (const separator of ["\n\n", "\n", ". ", " "]) {
    const found = text.lastIndexOf(separator, limit - separator.length);
    if (found >= earliest) return found + separator.length;
  }
  return limit;
}

/** Deterministic, so an interrupted indexing can resume where it stopped. */
export function chunkText(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    const end = chunkEnd(text, start);
    const chunk = text.slice(start, end);
    if (chunk.trim()) chunks.push({ startChar: start, text: chunk });
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }
  return chunks;
}

export async function indexAttachment(
  dataDir: string,
  repo: AttachmentRepository,
  id: number,
  embed: Embed,
): Promise<void> {
  const row = await repo.findById(id);
  // A file with scanned pages is indexed once OCR has read them.
  if (!row || row.indexedAt !== null || row.scan?.status === "pending") return;
  const text = await attachmentText(dataDir, row);
  if (text === undefined) return;

  const chunks = chunkText(text).slice(0, MAX_CHUNKS_PER_FILE);
  for (let i = await repo.countChunks(id); i < chunks.length; i++) {
    // The user can delete the file while it is being indexed.
    if (!(await repo.findById(id))) return;
    await repo.addChunk({
      attachmentId: id,
      chunkIndex: i,
      startChar: chunks[i].startChar,
      text: chunks[i].text,
      vector: JSON.stringify(await embed(chunks[i].text)),
    });
  }
  await repo.markIndexed(id, Date.now());
}

const scheduled = new Set<number>();
let queue: Promise<void> = Promise.resolve();

/** Indexes one file at a time, without making the caller wait for it. */
export function scheduleAttachmentIndexing(
  dataDir: string,
  repo: AttachmentRepository,
  id: number,
): void {
  if (scheduled.has(id)) return;
  scheduled.add(id);
  queue = queue
    .then(() => indexAttachment(dataDir, repo, id, embedText))
    .catch((error) =>
      console.error(`[Attachments] Could not index attachment ${id}:`, error)
    )
    .finally(() => {
      scheduled.delete(id);
    });
}
