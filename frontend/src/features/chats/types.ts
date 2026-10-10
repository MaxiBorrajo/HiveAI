export interface ChatStep {
  node:
    | "Solver"
    | "AbstentionVerificator"
    | "Executor"
    | "Diagnostician"
    | "HiveQueenResponder"
    | "Plugin"
    | "Agent";
  label: string;
  durationMs: number;
  summary: string;
}

export interface ThinkingRun {
  node: string | undefined;
  text: string;
}

// Mirrors backend/modules/usage/types.ts. Every figure is null when the
// provider did not report it; it is never a stand-in 0.
export interface TokenTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  // False when some call did not report tokens, so the sums are a lower bound.
  tokensComplete: boolean;
}

export type UsageLocation = "local" | "cloud";

export interface UsedModel {
  provider: string;
  model: string;
  location: UsageLocation;
  calls: number;
}

export interface MessageUsage extends TokenTotals {
  calls: number;
  failedCalls: number;
  tokensPerSecond: number | null;
  ttftMs: number | null;
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

// Local and cloud stay apart on purpose: there is no combined figure.
export interface ConversationUsage {
  local: UsageBucket;
  cloud: UsageBucket;
}

export interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  isError?: boolean;
  wasStopped?: boolean;
  timestamp: number;
  usedTools?: string[];
  steps?: ChatStep[];
  thinkingRuns?: ThinkingRun[];
  // undefined: the response is still streaming. null: no usage was recorded
  // for it (it predates usage tracking), shown as "—".
  usage?: MessageUsage | null;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  role: "user" | "agent";
  content: string;
  timestamp: number;
  metadata: {
    usedTools: string[];
    steps: ChatStep[];
    thinkingRuns?: ThinkingRun[];
    wasStopped?: boolean;
  } | null;
  usage: MessageUsage | null;
}

export interface ChatSummary {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}
