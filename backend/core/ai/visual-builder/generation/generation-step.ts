import { BaseMessage } from "@langchain/core/messages";
import { InvocableAgent } from "../types.ts";

const OLLAMA_CALL_TIMEOUT_MS = 30 * 60_000;
const OLLAMA_MAX_RETRIES = 2;

export async function invokeWithRetry<T>(
  runnable: { invoke: (input: any, config?: any) => Promise<T> },
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

export async function runConfigStep<TParsed, TResult>(params: {
  label: string;
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
