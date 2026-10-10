import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import type { Serialized } from "@langchain/core/load/serializable";
import { normalizeProviderError } from "../providers/errors.ts";
import type {
  UsageLocation,
  UsageRole,
} from "../../../infrastructure/db/schema/model_usage.ts";
import { getUsageContext, type UsageContext } from "./usage-context.ts";
import { getUsageRecorder, type UsageLink } from "./usage-recorder.ts";

export interface UsageModelInfo {
  provider: string;
  model: string;
  location: UsageLocation;
  keyId: string | null;
  keyAlias: string | null;
}

interface PendingCall {
  startedAt: number;
  firstTokenAt?: number;
  context: UsageContext | undefined;
  nodeId: string | null;
}

interface UsageMetadata {
  input_tokens?: unknown;
  output_tokens?: unknown;
  input_token_details?: { cache_read?: unknown; cache_creation?: unknown };
  output_token_details?: { reasoning?: unknown };
}

// A figure the provider did not report stays null; it is never completed with 0.
function reported(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function classifyUsageError(error: unknown, provider: string): string {
  const e = error as { name?: string; message?: string };
  if (e?.name === "AbortError" || /\babort(ed)?\b/i.test(e?.message ?? "")) {
    return "aborted";
  }
  return normalizeProviderError(error, provider).kind;
}

function linkFor(context: UsageContext | undefined, nodeId: string | null): UsageLink {
  switch (context?.kind) {
    case "chat":
      return context.chatId === undefined
        ? { kind: "other" }
        : { kind: "chat", chatId: context.chatId };
    case "execution":
      return context.executionId === undefined
        ? { kind: "other" }
        : { kind: "execution", executionId: context.executionId, nodeId };
    case "graph_generation":
      return { kind: "graph_generation", executionId: context.executionId ?? null };
    default:
      return { kind: "other" };
  }
}

// Attached to every chat model by the factory: one row per model call, written
// when the call ends (ok or error), identical for local and cloud models.
export class UsageCallbackHandler extends BaseCallbackHandler {
  name = "hiveai_usage";
  // The row must exist before the call returns, so a message can be linked to
  // its calls right after the stream ends.
  override awaitHandlers = true;

  private pending = new Map<string, PendingCall>();

  constructor(private info: UsageModelInfo) {
    super();
  }

  override handleChatModelStart(
    _llm: Serialized,
    _messages: unknown,
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    this.start(runId, metadata);
  }

  override handleLLMStart(
    _llm: Serialized,
    _prompts: string[],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    if (!this.pending.has(runId)) this.start(runId, metadata);
  }

  override handleLLMNewToken(
    _token: string,
    _idx: unknown,
    runId: string,
  ): void {
    const call = this.pending.get(runId);
    if (call && call.firstTokenAt === undefined) call.firstTokenAt = Date.now();
  }

  override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const generation = output.generations?.[0]?.[0] as
      | { message?: { usage_metadata?: UsageMetadata } }
      | undefined;
    const usage = generation?.message?.usage_metadata;
    await this.finish(runId, "ok", null, {
      inputTokens: reported(usage?.input_tokens),
      outputTokens: reported(usage?.output_tokens),
      cacheReadTokens: reported(usage?.input_token_details?.cache_read),
      cacheWriteTokens: reported(usage?.input_token_details?.cache_creation),
      reasoningTokens: reported(usage?.output_token_details?.reasoning),
    });
  }

  override async handleLLMError(error: unknown, runId: string): Promise<void> {
    await this.finish(
      runId,
      "error",
      classifyUsageError(error, this.info.provider),
      {},
    );
  }

  private start(runId: string, metadata?: Record<string, unknown>): void {
    const node = metadata?.langgraph_node;
    this.pending.set(runId, {
      startedAt: Date.now(),
      context: getUsageContext(),
      nodeId: typeof node === "string" ? node : null,
    });
  }

  private async finish(
    runId: string,
    status: "ok" | "error",
    errorType: string | null,
    tokens: Partial<{
      inputTokens: number | null;
      outputTokens: number | null;
      cacheReadTokens: number | null;
      cacheWriteTokens: number | null;
      reasoningTokens: number | null;
    }>,
  ): Promise<void> {
    const call = this.pending.get(runId);
    this.pending.delete(runId);
    const recorder = getUsageRecorder();
    if (!call || !recorder) return;

    const now = Date.now();
    const context = call.context;
    const role: UsageRole = context?.role ?? "orchestrator";
    try {
      await recorder.record({
        usage: {
          groupId: context?.groupId ?? crypto.randomUUID(),
          contextKind: context?.kind ?? "other",
          provider: this.info.provider,
          model: this.info.model,
          location: this.info.location,
          role,
          keyId: this.info.keyId,
          keyAlias: this.info.keyAlias,
          inputTokens: tokens.inputTokens ?? null,
          outputTokens: tokens.outputTokens ?? null,
          cacheReadTokens: tokens.cacheReadTokens ?? null,
          cacheWriteTokens: tokens.cacheWriteTokens ?? null,
          reasoningTokens: tokens.reasoningTokens ?? null,
          durationMs: now - call.startedAt,
          ttftMs:
            call.firstTokenAt === undefined
              ? null
              : call.firstTokenAt - call.startedAt,
          status,
          errorType,
          createdAt: now,
        },
        link: linkFor(context, call.nodeId),
      });
    } catch (error) {
      // Telemetry must never break the model call it describes.
      console.error("[Usage] Could not record the model call:", error);
    }
  }
}
