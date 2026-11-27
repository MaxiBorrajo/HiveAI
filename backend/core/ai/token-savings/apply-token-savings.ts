import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { ModelRef } from "../providers/types.ts";
import type { TokenSavingsConfig } from "./config.ts";
import { compactToolResults } from "./deterministic-compaction.ts";
import { patchGeminiContextCache } from "./gemini-context-cache.ts";
import { type SummarizerProvider, summarizeHistory } from "./llm-summary.ts";

export interface TokenSavingsDeps {
  /** Lazily builds the small-model summarizer; undefined when unavailable. */
  getSummarizer?: SummarizerProvider;
}

// deno-lint-ignore no-explicit-any
type AnyModel = any;

const warn = (what: string, error: unknown) =>
  console.warn(`[token-savings] ${what} failed, using unoptimized request:`, error);

/** Anthropic: automatic prompt caching via the request's top-level cache_control. */
function patchAnthropicCaching(model: AnyModel): void {
  if (typeof model.invocationParams !== "function") return;
  const original = model.invocationParams.bind(model);
  model.__cachingDisabled = false;
  model.invocationParams = (options: unknown) => {
    const params = original(options);
    if (model.__cachingDisabled || !params || params.cache_control) return params;
    return { ...params, cache_control: { type: "ephemeral" } };
  };
}

const isCacheControlRejection = (error: unknown) =>
  /cache_control/i.test(error instanceof Error ? error.message : String(error));

function patchMessageTransform(
  model: AnyModel,
  prepare: (messages: BaseMessage[]) => Promise<BaseMessage[]>,
  cachingPatched: boolean,
): void {
  const disableCaching = (error: unknown): boolean => {
    if (!cachingPatched || model.__cachingDisabled || !isCacheControlRejection(error)) {
      return false;
    }
    model.__cachingDisabled = true;
    warn("prompt caching (rejected by the API)", error);
    return true;
  };

  if (typeof model._generate === "function") {
    const original = model._generate.bind(model);
    model._generate = async (messages: BaseMessage[], ...rest: unknown[]) => {
      const prepared = await prepare(messages);
      try {
        return await original(prepared, ...rest);
      } catch (error) {
        if (!disableCaching(error)) throw error;
        return await original(prepared, ...rest);
      }
    };
  }

  for (const name of ["_streamResponseChunks", "_streamChatModelEvents"]) {
    if (typeof model[name] !== "function") continue;
    const original = model[name].bind(model);
    model[name] = async function* (messages: BaseMessage[], ...rest: unknown[]) {
      const prepared = await prepare(messages);
      let yielded = false;
      try {
        for await (const chunk of original(prepared, ...rest)) {
          yielded = true;
          yield chunk;
        }
      } catch (error) {
        if (yielded || !disableCaching(error)) throw error;
        yield* original(prepared, ...rest);
      }
    };
  }
}

/**
 * Wraps a freshly built cloud model so every request goes through the token
 * saving pipeline. Mechanisms a provider does not support are skipped, and any
 * failure falls back to the original, unoptimized messages.
 */
export function applyTokenSavings<T extends BaseChatModel>(
  model: T,
  ref: ModelRef,
  cfg: TokenSavingsConfig,
  deps: TokenSavingsDeps = {},
): T {
  const m = model as AnyModel;
  let cachingPatched = false;

  if (cfg.promptCaching && ref.provider === "anthropic") {
    try {
      patchAnthropicCaching(m);
      cachingPatched = true;
    } catch (error) {
      warn("prompt caching setup", error);
    }
  }

  if (cfg.geminiContextCache && ref.provider === "google") {
    try {
      patchGeminiContextCache(m, cfg);
    } catch (error) {
      warn("gemini context cache setup", error);
    }
  }

  const transforms = cfg.deterministicCompaction ||
    (cfg.llmSummary && deps.getSummarizer);

  if (transforms || cachingPatched) {
    const prepare = async (messages: BaseMessage[]): Promise<BaseMessage[]> => {
      let out = messages;
      if (cfg.deterministicCompaction) {
        try {
          out = compactToolResults(out, cfg);
        } catch (error) {
          warn("compaction", error);
          out = messages;
        }
      }
      if (cfg.llmSummary && deps.getSummarizer) {
        try {
          out = await summarizeHistory(out, cfg, deps.getSummarizer);
        } catch (error) {
          warn("summary", error);
        }
      }
      return out;
    };
    try {
      patchMessageTransform(m, prepare, cachingPatched);
    } catch (error) {
      warn("message pipeline setup", error);
    }
  }

  return model;
}
