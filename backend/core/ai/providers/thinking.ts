import { AIMessage, type BaseMessage } from "@langchain/core/messages";
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

// Anthropic thinking blocks are signed against the exact tools list of the
// request that produced them; the forced final call drops the tools, so the
// signatures would be rejected. Strip them from the replayed conversation.
export function stripThinkingBlocks(conversation: BaseMessage[]): BaseMessage[] {
  return conversation.map((msg) => {
    if (!AIMessage.isInstance(msg) || !Array.isArray(msg.content)) return msg;
    const content = msg.content.filter(
      (block) =>
        typeof block !== "object" ||
        (block.type !== "thinking" && block.type !== "redacted_thinking"),
    );
    if (content.length === msg.content.length) return msg;
    return new AIMessage({
      content,
      tool_calls: msg.tool_calls,
      additional_kwargs: msg.additional_kwargs,
      response_metadata: msg.response_metadata,
      id: msg.id,
    });
  });
}

