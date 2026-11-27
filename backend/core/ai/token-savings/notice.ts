import { AsyncLocalStorage } from "node:async_hooks";

export interface CompactionNotice {
  kind: "llm-summary";
  /** Estimated chars before / after the summary. */
  beforeChars: number;
  afterChars: number;
  durationMs: number;
}

export type CompactionListener = (notice: CompactionNotice) => void;

const storage = new AsyncLocalStorage<CompactionListener>();

/** Lets a caller (e.g. the chat) observe LLM summaries run inside `fn`. */
export function withCompactionListener<T>(
  listener: CompactionListener,
  fn: () => T,
): T {
  return storage.run(listener, fn);
}

export function notifyCompaction(notice: CompactionNotice): void {
  try {
    storage.getStore()?.(notice);
  } catch (error) {
    console.warn("[token-savings] compaction listener failed:", error);
  }
}
