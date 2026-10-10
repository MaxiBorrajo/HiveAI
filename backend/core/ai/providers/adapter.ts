import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatModelOptions } from "./create-chat-model.ts";
import type { CloudProvider } from "./types.ts";

export interface CloudModel {
  name: string;
  label?: string;
  capabilities: string[];
}


export interface ProviderAdapter {
  id: CloudProvider;
  label: string;
  validateKey(apiKey: string, fetchFn: typeof fetch): Promise<void>;
  listModels(apiKey: string, fetchFn: typeof fetch): Promise<CloudModel[]>;
  createModel(
    model: string,
    apiKey: string,
    options: ChatModelOptions,
  ): BaseChatModel;
}

export async function getJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const res = await fetchFn(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export function toCloudModel(name: string, label?: string): CloudModel {
  return { name, label, capabilities: ["tools"] };
}
