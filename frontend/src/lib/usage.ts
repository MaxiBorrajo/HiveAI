export interface TokenTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
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

export interface ConversationUsage {
  local: UsageBucket;
  cloud: UsageBucket;
}


export type UsageStatus = "ok" | "error";

export interface RunModel {
  provider: string;
  model: string;
  location: UsageLocation;
  keyId: string | null;
  keyAlias: string | null;
}

export interface RunOrchestrator extends RunModel {
  source: "generation" | "current";
}

export interface RunModelTotals extends ModelTotals {
  location: UsageLocation;
}

export interface RunBucket extends TokenTotals {
  calls: number;
  failedCalls: number;
  models: RunModelTotals[];
}

export interface RunCall {
  provider: string;
  model: string;
  location: UsageLocation;
  keyAlias: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  durationMs: number;
  ttftMs: number | null;
  status: UsageStatus;
  errorType: string | null;
}

export interface RunNodeUsage {
  nodeId: string | null;
  nodeName: string;
  nodeType: string | null;
  configuredModel: RunModel | null;
  calls: RunCall[];
  failedCalls: number;
}

export interface TokenPair {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface RunDelegation {
  orchestrator: TokenPair;
  orchestratorCalls: number;
  delegated: TokenPair;
  local: TokenPair;
  delegatedShare: number | null;
  localShare: number | null;
}
export interface RunUsage {
  latencyMs: number | null;
  calls: number;
  failedCalls: number;
  orchestrator: RunOrchestrator | null;
  local: RunBucket;
  cloud: RunBucket;
  delegation: RunDelegation;
  nodes: RunNodeUsage[];
}
