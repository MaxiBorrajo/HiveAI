import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ModelUnavailableError } from "./errors.ts";
import { getAdapter } from "./registry.ts";
import { isCloudProvider, type ModelRef } from "./types.ts";
import { UsageCallbackHandler } from "../usage/usage-callback.ts";

export interface ChatModelOptions {
  temperature?: number;
  maxTokens?: number;
  think?: boolean;
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

// The only place a chat model is built: every model gets the usage callback
// here, so no call site has to record its own consumption.
export async function createChatModel(
  ref: ModelRef,
  options: ChatModelOptions = {},
  resolveSecret: SecretResolver = secretResolver,
): Promise<ProviderChatModel> {
  const model = await buildModel(ref, options, resolveSecret);
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

async function buildModel(
  ref: ModelRef,
  options: ChatModelOptions,
  resolveSecret: SecretResolver,
): Promise<BaseChatModel> {
  if (!ref.model) {
    throw new ModelUnavailableError("No model was selected.", ref.provider);
  }

  if (ref.provider === "ollama") {
    return new ChatOllama({ ...options, model: ref.model });
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
