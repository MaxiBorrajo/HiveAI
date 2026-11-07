import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ModelUnavailableError } from "./errors.ts";
import { getAdapter } from "./registry.ts";
import { isCloudProvider, type ModelRef } from "./types.ts";
import { UsageCallbackHandler } from "../usage/usage-callback.ts";
import { applyTokenSavings } from "../token-savings/apply-token-savings.ts";
import {
  resolveTokenSavings,
  type TokenSavingsOverride,
} from "../token-savings/config.ts";
import {
  type Summarizer,
  summarizerFromModel,
} from "../token-savings/llm-summary.ts";
import { resolveSmallModelRef } from "../token-savings/small-model.ts";

export interface ChatModelOptions {
  temperature?: number;
  maxTokens?: number;
  think?: boolean;
  /** Internal: override the token-saving mechanisms (`false` disables all). Cloud only. */
  tokenSavings?: TokenSavingsOverride;
  [ollamaOption: string]: unknown;
}

export type ProviderChatModel = BaseChatModel &
  Required<Pick<BaseChatModel, "bindTools">>;

export type SecretResolver = (keyId: string) => Promise<string | undefined>;

let secretResolver: SecretResolver = () => Promise.resolve(undefined);

export function setSecretResolver(resolver: SecretResolver): void {
  secretResolver = resolver;
}

export type KeyAliasResolver = (keyId: string) => Promise<string | undefined>;

let keyAliasResolver: KeyAliasResolver = () => Promise.resolve(undefined);

export function setKeyAliasResolver(resolver: KeyAliasResolver): void {
  keyAliasResolver = resolver;
}

export async function createChatModel(
  ref: ModelRef,
  options: ChatModelOptions = {},
  resolveSecret: SecretResolver = secretResolver,
): Promise<ProviderChatModel> {
  const { tokenSavings, ...modelOptions } = options;
  const model = await buildModel(ref, modelOptions, resolveSecret);
  if (isCloudProvider(ref.provider)) {
    applyTokenSavings(
      model,
      ref,
      resolveTokenSavings(tokenSavings as TokenSavingsOverride | undefined),
      { getSummarizer: () => buildSummarizer(ref, resolveSecret) },
    );
  }
  const keyAlias = ref.keyId
    ? ((await keyAliasResolver(ref.keyId)) ?? null)
    : null;
  const handler = new UsageCallbackHandler({
    provider: ref.provider,
    model: ref.model,
    location: isCloudProvider(ref.provider) ? "cloud" : "local",
    keyId: ref.keyId ?? null,
    keyAlias,
  });
  model.callbacks = [
    ...(Array.isArray(model.callbacks) ? model.callbacks : []),
    handler,
  ];
  return model as ProviderChatModel;
}

/**
 * Model for cheap auxiliary tasks (naming, clarification): the provider's
 * small model on the same key when one is found, otherwise `ref` unchanged.
 * Local models and disabled `smallModelForAux` return `ref` as is.
 */
export async function resolveAuxiliaryModelRef(
  ref: ModelRef,
  override?: TokenSavingsOverride,
  resolveSecret: SecretResolver = secretResolver,
): Promise<ModelRef> {
  try {
    if (!isCloudProvider(ref.provider)) return ref;
    if (!resolveTokenSavings(override).smallModelForAux) return ref;
    return (await resolveSmallModelRef(ref, resolveSecret)) ?? ref;
  } catch {
    return ref;
  }
}

async function buildSummarizer(
  ref: ModelRef,
  resolveSecret: SecretResolver,
): Promise<Summarizer | undefined> {
  const target = (await resolveSmallModelRef(ref, resolveSecret)) ?? ref;
  const llm = await createChatModel(
    target,
    { maxTokens: 1024, tokenSavings: false },
    resolveSecret,
  );
  return summarizerFromModel(llm);
}

function isOllamaCloudModel(model: string): boolean {
  return /[:-]cloud$/.test(model);
}

// Ollama Cloud forwards num_predict as max_tokens and rejects the local "-1" (unlimited).
export function withoutUnlimitedPredictForCloud(
  model: string,
  options: ChatModelOptions,
): ChatModelOptions {
  const { numPredict, ...rest } = options;
  const unlimited = typeof numPredict === "number" && numPredict <= 0;
  if (unlimited && isOllamaCloudModel(model)) return rest;
  return options;
}

async function buildModel(
  ref: ModelRef,
  options: ChatModelOptions,
  resolveSecret: SecretResolver,
): Promise<BaseChatModel> {
  if (!ref.model) {
    throw new ModelUnavailableError("No model was selected.", ref.provider);
  }

  if (ref.provider === "ollama") {
    return new ChatOllama({
      ...withoutUnlimitedPredictForCloud(ref.model, options),
      model: ref.model,
    });
  }

  if (!isCloudProvider(ref.provider)) {
    throw new ModelUnavailableError(
      `Unknown provider '${ref.provider}'.`,
      ref.provider,
    );
  }

  const adapter = getAdapter(ref.provider);

  if (!ref.keyId) {
    throw new ModelUnavailableError(
      `${adapter.label} model '${ref.model}' has no API key selected.`,
      ref.provider,
    );
  }
  const apiKey = await resolveSecret(ref.keyId);

  if (!apiKey) {
    throw new ModelUnavailableError(
      `The API key used for ${adapter.label} model '${ref.model}' no longer exists.`,
      ref.provider,
    );
  }
  
  return adapter.createModel(ref.model, apiKey, options);
}
