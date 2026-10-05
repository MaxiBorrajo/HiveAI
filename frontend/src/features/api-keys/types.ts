export type CloudProvider = "ollama-cloud" | "anthropic" | "openai" | "google";

export const PROVIDER_LABELS: Record<CloudProvider, string> = {
  "ollama-cloud": "Ollama Cloud",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
};

export const CLOUD_PROVIDERS = Object.keys(PROVIDER_LABELS) as CloudProvider[];

export interface ApiKey {
  id: string;
  provider: CloudProvider;
  alias: string;
  /** Only the last characters are ever sent by the backend, e.g. "••••a1b2". */
  masked: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApiKeyUsage {
  chat: boolean;
  executions: { id: number; name: string; nodeIds: string[] }[];
}
