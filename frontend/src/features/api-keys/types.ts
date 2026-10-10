export type CloudProvider = "anthropic" | "google";

export const PROVIDER_LABELS: Record<CloudProvider, string> = {
  anthropic: "Anthropic",
  google: "Google Gemini",
};

export const CLOUD_PROVIDERS = Object.keys(PROVIDER_LABELS) as CloudProvider[];

export interface ApiKey {
  id: string;
  provider: CloudProvider;
  alias: string;
  masked: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApiKeyUsage {
  chat: boolean;
  executions: { id: number; name: string; nodeIds: string[] }[];
}
