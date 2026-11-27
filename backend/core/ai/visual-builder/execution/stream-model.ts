import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { splitContent } from "../../providers/capabilities.ts";
import { InlineThinkingSplitter } from "../../providers/inline-thinking.ts";
import { findRepetitionLoop, RepetitionWatcher } from "../../providers/repetition-loop.ts";

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
  // Inline <think>…</think> goes to the reasoning, never into the node's output.
  const splitter = new InlineThinkingSplitter();
  let thinking = "";
  const textWatcher = new RepetitionWatcher();
  const thinkingWatcher = new RepetitionWatcher();
  let looped = false;

  try {
    armIdleTimer();
    const stream = await model.stream(input, { signal: controller.signal });
    for await (const raw of stream) {
      waitMs = idleTimeoutMs;
      armIdleTimer();
      const chunk = raw as AIMessageChunk;
      accumulated = accumulated ? accumulated.concat(chunk) : chunk;
      const split = splitter.push(chunkText(chunk));
      thinking += split.thinking;
      const text = split.text;
      if (text) {
        partial += text;
        onToken?.(text);
      }
      if (textWatcher.check(partial) !== null || thinkingWatcher.check(thinking) !== null) {
        looped = true;
        controller.abort();
        break;
      }
    }
  } catch (err) {
    // The abort that stopped a loop is not a failure: what came before it is the answer.
    if (!looped) throw interruption(err);
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  function interruption(err: unknown): unknown {
    if (signal?.aborted) {
      return new StreamInterruptedError("Execution cancelled.", partial, err);
    }
    if (timedOut) {
      return new StreamInterruptedError(
        `The model produced no output for ${Math.round((accumulated ? idleTimeoutMs : Math.max(firstChunkTimeoutMs, idleTimeoutMs)) / 1000)}s${accumulated ? "" : " (no response started)"}.`,
        partial,
        err,
      );
    }
    if (partial) {
      const reason = err instanceof Error ? err.message : String(err);
      return new StreamInterruptedError(
        `Stream interrupted: ${reason}`,
        partial,
        err,
      );
    }
    return err;
  }

  if (!accumulated) return new AIMessage("");
  if (!looped) {
    const rest = splitter.flush();
    thinking += rest.thinking;
    partial += rest.text;
  }
  const loopCut = looped ? findRepetitionLoop(partial) : null;
  if (looped) {
    thinking = thinking.slice(0, findRepetitionLoop(thinking) ?? thinking.length);
    console.warn("[Stream] The model fell into a repetition loop; its output was cut where the loop began.");
  }
  // Plain-text replies carry what was shown; block content (cloud) is left as the provider sent it.
  const content = typeof accumulated.content === "string" || looped
    ? (loopCut !== null ? partial.slice(0, loopCut) : partial)
    : accumulated.content;
  return new AIMessage({
    content,
    tool_calls: accumulated.tool_calls,
    additional_kwargs: thinking
      ? {
        ...accumulated.additional_kwargs,
        reasoning_content: `${accumulated.additional_kwargs?.reasoning_content ?? ""}${thinking}`,
      }
      : accumulated.additional_kwargs,
    response_metadata: looped
      ? { ...accumulated.response_metadata, repetitionLoop: true }
      : accumulated.response_metadata,
    usage_metadata: accumulated.usage_metadata,
    id: accumulated.id,
  });
}
