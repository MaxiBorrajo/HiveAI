import { ChatOllama } from "@langchain/ollama";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ModelUnavailableError } from "./errors.ts";
import {
  isCloudProvider,
  type ModelRef,
  OLLAMA_CLOUD_URL,
  PROVIDER_LABELS,
} from "./types.ts";

/**
 * Provider-agnostic options come first; anything else is treated as
 * Ollama-specific (numCtx, numGpu, keep-alive, ...) and only applied to the
 * local Ollama provider.
 */
export interface ChatModelOptions {
  temperature?: number;
  maxTokens?: number;
  think?: boolean;
  [ollamaOption: string]: unknown;
}

/** Every provider we support can bind tools. */
export type ProviderChatModel = BaseChatModel &
  Required<Pick<BaseChatModel, "bindTools">>;

export type SecretResolver = (keyId: string) => Promise<string | undefined>;

let secretResolver: SecretResolver = () => Promise.resolve(undefined);

/** Wired at startup to the encrypted secret store. */
export function setSecretResolver(resolver: SecretResolver): void {
  secretResolver = resolver;
}

const ANTHROPIC_THINKING_BUDGET = 2048;

export async function createChatModel(
  ref: ModelRef,
  options: ChatModelOptions = {},
  resolveSecret: SecretResolver = secretResolver,
): Promise<ProviderChatModel> {
  return (await buildModel(ref, options, resolveSecret)) as ProviderChatModel;
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

  const label = PROVIDER_LABELS[ref.provider];
  if (!ref.keyId) {
    throw new ModelUnavailableError(
      `${label} model '${ref.model}' has no API key selected.`,
      ref.provider,
    );
  }
  const apiKey = await resolveSecret(ref.keyId);
  if (!apiKey) {
    throw new ModelUnavailableError(
      `The API key used for ${label} model '${ref.model}' no longer exists.`,
      ref.provider,
    );
  }

  const { temperature, maxTokens, think } = options;

  switch (ref.provider) {
    case "ollama-cloud":
      return new ChatOllama({
        model: ref.model,
        baseUrl: OLLAMA_CLOUD_URL,
        headers: { Authorization: `Bearer ${apiKey}` },
        temperature,
        numPredict: maxTokens,
        think,
      });
    case "anthropic":
      return new ChatAnthropic({
        model: ref.model,
        apiKey,
        ...(think
          ? {
              thinking: {
                type: "enabled",
                budget_tokens: ANTHROPIC_THINKING_BUDGET,
              },
              maxTokens: Math.max(
                maxTokens ?? 0,
                ANTHROPIC_THINKING_BUDGET * 2,
              ),
            }
          : { temperature, maxTokens }),
      });
    case "openai":
      return new ChatOpenAI({
        model: ref.model,
        apiKey,
        temperature,
        maxTokens,
      });
    case "google":
      return new ChatGoogleGenerativeAI({
        model: ref.model,
        apiKey,
        temperature,
        maxOutputTokens: maxTokens,
      });
  }
}
