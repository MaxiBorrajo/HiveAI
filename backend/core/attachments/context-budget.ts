import { MAX_TOTAL_CONTEXT_CHARS } from "./attachment-limits.ts";

// What Ollama gives a model when the request does not set num_ctx.
export const OLLAMA_DEFAULT_NUM_CTX = 4096;

const CHARS_PER_TOKEN = 3;
const ATTACHMENT_SHARE = 0.5;
const EXCERPT_SHARE = 0.25;
const MAX_EXCERPT_CHARS = 12_000;

export interface AttachmentBudget {
  attachmentChars: number;
  excerptChars: number;
}

/**
 * How much file text fits in a request. Ollama silently drops what exceeds a
 * model's context window, so local models get a share of theirs and the rest
 * of each file is left to search. `numCtx` is undefined for cloud models.
 */
export function attachmentBudget(numCtx: number | undefined): AttachmentBudget {
  const contextChars = numCtx === undefined
    ? Infinity
    : numCtx * CHARS_PER_TOKEN;
  return {
    attachmentChars: Math.min(
      MAX_TOTAL_CONTEXT_CHARS,
      Math.floor(contextChars * ATTACHMENT_SHARE),
    ),
    excerptChars: Math.min(
      MAX_EXCERPT_CHARS,
      Math.floor(contextChars * EXCERPT_SHARE),
    ),
  };
}
