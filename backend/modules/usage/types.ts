import type { UsageLocation } from "../../infrastructure/db/schema/model_usage.ts";

// Every token figure is the sum of what the provider reported, or null when no
// call reported it. A missing figure is never turned into 0.
export interface TokenTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  // False when some successful call did not report its tokens, so the sums
  // above are a lower bound.
  tokensComplete: boolean;
}

export interface UsedModel {
  provider: string;
  model: string;
  location: UsageLocation;
  calls: number;
}

// One chat response, summing every model call made for it (agent iterations,
// tool-selection calls, verifiers).
export interface MessageUsage extends TokenTotals {
  calls: number;
  failedCalls: number;
  // Output tokens over generation time (call duration minus time to first
  // token). Tool waits happen between calls, so they are never in it.
  tokensPerSecond: number | null;
  // Time to first token of the first model call of the response.
  ttftMs: number | null;
  // Wall clock from the first call starting to the last one ending.
  latencyMs: number;
  models: UsedModel[];
}

export interface ModelTotals extends TokenTotals {
  provider: string;
  model: string;
  keyAliases: string[];
  calls: number;
  failedCalls: number;
  tokensPerSecond: number | null;
}

export interface UsageBucket extends TokenTotals {
  calls: number;
  failedCalls: number;
  models: ModelTotals[];
}

// Local and cloud are kept apart on purpose: there is no combined figure.
export interface ConversationUsage {
  local: UsageBucket;
  cloud: UsageBucket;
}
