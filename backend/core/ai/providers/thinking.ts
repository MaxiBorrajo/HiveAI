import type { ModelRef } from "./types.ts";

const unsupported = new Set<string>();

const keyOf = (ref: ModelRef) => `${ref.provider}:${ref.model}`;

export function shouldRequestThinking(ref: ModelRef): boolean {
  return !unsupported.has(keyOf(ref));
}

export function markThinkingUnsupported(ref: ModelRef): void {
  unsupported.add(keyOf(ref));
}

export function isThinkingRejection(error: unknown): boolean {
  const e = error as { status?: number; message?: string };
  const message = String(e?.message ?? error);
  return (
    (e?.status === 400 || /\b400\b|invalid_request/i.test(message)) &&
    /thinking|think\b|reasoning/i.test(message)
  );
}
