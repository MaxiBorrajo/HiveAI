import { setUsageRecorder, type UsageEntry } from "../../core/ai/usage/usage-recorder.ts";

export interface CapturedUsage {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

let buffer: UsageEntry[] = [];

/**
 * Registers an in-memory usage recorder for the lifetime of the eval process.
 * Safe to call once at startup — it never touches the production DB.
 */
export function installInMemoryUsageRecorder(): void {
  setUsageRecorder({
    record: (entry) => {
      buffer.push(entry);
      return Promise.resolve();
    },
  });
}

/**
 * Runs `fn`, capturing every model call it triggers (via the UsageCallbackHandler
 * that createChatModel() attaches automatically), and returns both the result
 * and the aggregated token/duration totals for that single invocation.
 *
 * Must not be called concurrently with another captureUsage() — the eval
 * runners are expected to process one case at a time.
 */
export async function captureUsage<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; usage: CapturedUsage }> {
  buffer = [];
  const result = await fn();
  const usage: CapturedUsage = {
    inputTokens: buffer.reduce((sum, e) => sum + (e.usage.inputTokens ?? 0), 0),
    outputTokens: buffer.reduce((sum, e) => sum + (e.usage.outputTokens ?? 0), 0),
    durationMs: buffer.reduce((sum, e) => sum + e.usage.durationMs, 0),
  };
  buffer = [];
  return { result, usage };
}
