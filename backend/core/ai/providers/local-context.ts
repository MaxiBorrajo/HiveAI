import { Ollama } from "ollama";

// Ollama silently truncates the prompt to a small default window (often 4k tokens).
// Executions pass whole documents between nodes, so use the model's own window up to a cap.
export const MAX_LOCAL_NUM_CTX = 16384;

const cache = new Map<string, number | undefined>();

export async function resolveLocalNumCtx(model: string): Promise<number | undefined> {
  if (cache.has(model)) return cache.get(model);
  let ctx: number | undefined;
  try {
    const info = (await new Ollama().show({ model })).model_info as unknown as Record<string, unknown>;
    const arch = info["general.architecture"] as string;
    const modelCtx = info[`${arch}.context_length`] as number | undefined;
    if (modelCtx) ctx = Math.min(modelCtx, MAX_LOCAL_NUM_CTX);
  } catch {
    ctx = undefined;
  }
  cache.set(model, ctx);
  return ctx;
}

/** Adds numCtx to Ollama options unless the caller already set one. */
export async function withLocalNumCtx(
  provider: string,
  model: string,
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (provider !== "ollama" || options.numCtx !== undefined) return options;
  const numCtx = await resolveLocalNumCtx(model);
  return numCtx ? { ...options, numCtx } : options;
}
