import { BaseMessage } from "@langchain/core/messages";

// Local models on modest/no-GPU hardware can legitimately take minutes per
// call — this is a last-resort safety net against a truly stuck call, not a
// performance limit, so it's set very high on purpose.
const OLLAMA_CALL_TIMEOUT_MS = 30 * 60_000;
const OLLAMA_MAX_RETRIES = 2; // up to 3 total attempts

/**
 * Wraps a LangChain Runnable's .invoke() with a per-attempt timeout and a
 * bounded number of retries (linear backoff). Ollama can hang indefinitely
 * with no timeout of its own — this caps how long any single generation
 * step can block before its caller's existing fallback (heuristic skeleton,
 * emergency node config, etc.) takes over, instead of the whole generation
 * stalling forever.
 */
export async function invokeWithRetry<T>(
  // deno-lint-ignore no-explicit-any
  runnable: { invoke: (input: any, config?: any) => Promise<T> },
  // deno-lint-ignore no-explicit-any
  input: any,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= OLLAMA_MAX_RETRIES + 1; attempt++) {
    try {
      return await runnable.invoke(input, { timeout: OLLAMA_CALL_TIMEOUT_MS });
    } catch (err) {
      lastErr = err;
      console.warn(
        `[Visual Builder - Generator] ${label} failed (attempt ${attempt}/${OLLAMA_MAX_RETRIES + 1}):`,
        err instanceof Error ? err.message : String(err),
      );
      if (attempt <= OLLAMA_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastErr;
}

// Minimal shape shared by ChatOllama and .withStructuredOutput(...) runnables
// — just enough for invokeWithRetry to call .invoke() on it. Deliberately
// untyped on the resolved value: LangChain's own .withStructuredOutput(...)
// return type doesn't propagate the Zod schema's inferred type cleanly
// through a generic parameter, so callers narrow the parsed result inside
// their own onSuccess via `as z.infer<typeof theirSchema>`, exactly as the
// pre-refactor code did with invokeWithRetry's result.
interface InvocableAgent {
  // deno-lint-ignore no-explicit-any
  invoke: (input: any, config?: any) => Promise<any>;
}

/**
 * Collapses the pattern repeated across every generation phase: build a
 * structured-output agent from a Zod schema, invoke it (with retry) against
 * a set of prompt messages, and normalize the result — falling back to a
 * heuristic/manual result if the LLM call ultimately fails. `onFallback`
 * must never throw: it is the last line of defense keeping generation alive
 * when the local model is unavailable or times out.
 */
export async function runConfigStep<TParsed, TResult>(params: {
  label: string; // used in invokeWithRetry's retry/backoff logs
  agent: InvocableAgent;
  messages: BaseMessage[];
  onSuccess: (parsed: TParsed) => TResult;
  onFallback: (err: unknown) => TResult;
}): Promise<TResult> {
  const { label, agent, messages, onSuccess, onFallback } = params;
  try {
    const parsed = (await invokeWithRetry(agent, messages, label)) as TParsed;
    return onSuccess(parsed);
  } catch (err) {
    return onFallback(err);
  }
}
