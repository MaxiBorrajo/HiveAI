import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { splitContent } from "../../providers/capabilities.ts";

export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

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
  { signal, idleTimeoutMs = DEFAULT_STREAM_IDLE_TIMEOUT_MS, onToken }: StreamOptions = {},
): Promise<AIMessage> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", onExternalAbort, { once: true });

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };

  let accumulated: AIMessageChunk | undefined;
  let partial = "";

  try {
    armIdleTimer();
    const stream = await model.stream(input, { signal: controller.signal });
    for await (const raw of stream) {
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
        `The model produced no output for ${Math.round(idleTimeoutMs / 1000)}s.`,
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
