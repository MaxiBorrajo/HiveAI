import { cloudModelSupportsThinking } from "./capabilities.ts";
import { type CloudProvider, OLLAMA_CLOUD_URL } from "./types.ts";

export interface CloudModel {
  name: string;
  label?: string;
  capabilities: string[];
}

/** Shown when the provider's model list can't be fetched. */
export const FALLBACK_MODELS: Record<CloudProvider, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4.1", "gpt-4.1-mini"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  "ollama-cloud": [
    "deepseek-v3.1:671b-cloud",
    "glm-4.6:cloud",
    "gpt-oss:120b-cloud",
  ],
};

const OPENAI_EXCLUDE =
  /embed|tts|whisper|dall-e|audio|realtime|moderation|image|transcribe|search|instruct$/i;

function toModel(provider: CloudProvider, name: string, label?: string): CloudModel {
  return {
    name,
    label,
    capabilities: [
      "tools",
      ...(cloudModelSupportsThinking(provider, name) ? ["thinking"] : []),
    ],
  };
}

async function getJson(
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

/** Lists the chat models a key can use. Throws if the provider call fails. */
export async function listCloudModels(
  provider: CloudProvider,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<CloudModel[]> {
  switch (provider) {
    case "anthropic": {
      const json = await getJson(
        "https://api.anthropic.com/v1/models?limit=100",
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        fetchFn,
      );
      return ((json.data ?? []) as { id: string; display_name?: string }[]).map(
        (m) => toModel(provider, m.id, m.display_name),
      );
    }
    case "openai": {
      const json = await getJson(
        "https://api.openai.com/v1/models",
        { Authorization: `Bearer ${apiKey}` },
        fetchFn,
      );
      return ((json.data ?? []) as { id: string }[])
        .filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id) && !OPENAI_EXCLUDE.test(m.id))
        .map((m) => toModel(provider, m.id))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    case "google": {
      const json = await getJson(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
        { "x-goog-api-key": apiKey },
        fetchFn,
      );
      return (
        (json.models ?? []) as {
          name: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }[]
      )
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => toModel(provider, m.name.replace(/^models\//, ""), m.displayName));
    }
    case "ollama-cloud": {
      const json = await getJson(
        `${OLLAMA_CLOUD_URL}/api/tags`,
        { Authorization: `Bearer ${apiKey}` },
        fetchFn,
      );
      return ((json.models ?? []) as { name: string }[]).map((m) =>
        toModel(provider, m.name),
      );
    }
  }
}

export function fallbackModels(provider: CloudProvider): CloudModel[] {
  return FALLBACK_MODELS[provider].map((name) => toModel(provider, name));
}
