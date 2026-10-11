import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatModelOptions } from "./create-chat-model.ts";
import type { CloudProvider } from "./types.ts";
import { type ToolSupport } from "./tool-support.ts";

export interface CloudModel {
  name: string;
  label?: string;
  capabilities: string[];
  toolSupport: ToolSupport;
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

// `capabilities` only ever lists what the provider confirmed for the model.
export function toCloudModel(
  name: string,
  label: string | undefined,
  toolSupport: ToolSupport,
): CloudModel {
  return {
    name,
    label,
    capabilities: toolSupport.status === "supported" ? ["tools"] : [],
    toolSupport,
  };
}
