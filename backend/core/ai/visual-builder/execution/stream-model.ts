import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { splitContent } from "../../providers/capabilities.ts";

// Adaptive thinking can stream nothing visible (no text, sparse summaries) for
// minutes on large prompts, so this must be generous.
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 240_000;
// Large prompts (e.g. several research outputs merged) and provider-side
// rate-limit retries can delay the first chunk well past the idle gap.
export const DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS = 240_000;

export class StreamInterruptedError extends Error {
  constructor(
    message: string,
    public readonly partial: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "StreamInterruptedError";
  }
}

interface Streamable {
  stream(
    input: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<unknown>>;
}

export interface StreamOptions {
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  firstChunkTimeoutMs?: number;
  onToken?: (text: string) => void;
}

function chunkText(chunk: AIMessageChunk): string {
  return Array.isArray(chunk.content)
    ? splitContent(chunk.content).text
    : chunk.content;
}

export async function streamToMessage(
  model: Streamable,
  input: unknown,
  {
    signal,
    idleTimeoutMs = DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    firstChunkTimeoutMs = DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
    onToken,
  }: StreamOptions = {},
): Promise<AIMessage> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", onExternalAbort, { once: true });

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let waitMs = Math.max(firstChunkTimeoutMs, idleTimeoutMs);
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    const ms = waitMs;
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };

  let accumulated: AIMessageChunk | undefined;
  let partial = "";

  try {
    armIdleTimer();
    const stream = await model.stream(input, { signal: controller.signal });
    for await (const raw of stream) {
      waitMs = idleTimeoutMs;
      armIdleTimer();
      const chunk = raw as AIMessageChunk;
      accumulated = accumulated ? accumulated.concat(chunk) : chunk;
      const text = chunkText(chunk);
      if (text) {
        partial += text;
        onToken?.(text);
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      throw new StreamInterruptedError("Execution cancelled.", partial, err);
    }
    if (timedOut) {
      throw new StreamInterruptedError(
        `The model produced no output for ${Math.round((accumulated ? idleTimeoutMs : Math.max(firstChunkTimeoutMs, idleTimeoutMs)) / 1000)}s${accumulated ? "" : " (no response started)"}.`,
        partial,
        err,
      );
    }
    if (partial) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new StreamInterruptedError(
        `Stream interrupted: ${reason}`,
        partial,
        err,
      );
    }
    throw err;
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  if (!accumulated) return new AIMessage("");
  return new AIMessage({
    content: accumulated.content,
    tool_calls: accumulated.tool_calls,
    additional_kwargs: accumulated.additional_kwargs,
    response_metadata: accumulated.response_metadata,
    usage_metadata: accumulated.usage_metadata,
    id: accumulated.id,
  });
}
