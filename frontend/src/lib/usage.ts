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

// ---- One run of an execution (mirrors backend/modules/usage/types.ts) ----

export type UsageStatus = "ok" | "error";

// The model of a node as it was resolved when the run started, and the key
// alias as it was then.
export interface RunModel {
  provider: string;
  model: string;
  location: UsageLocation;
  keyId: string | null;
  keyAlias: string | null;
}

export interface RunOrchestrator extends RunModel {
  // "current": the graph predates recording its orchestrator, so the chat's
  // model at run time was assumed.
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

// The orchestrator is the model that generated the graph; every node of a run
// is delegated work.
export interface RunDelegation {
  // What designing the graph cost. Null tokens when no generation was recorded.
  orchestrator: TokenPair;
  orchestratorCalls: number;
  // What this run's nodes consumed.
  delegated: TokenPair;
  // Of the delegated work, what ran on local models.
  local: TokenPair;
  // delegated / (orchestrator + delegated); null without orchestrator data.
  delegatedShare: number | null;
  // local / delegated.
  localShare: number | null;
}

// Local and cloud stay apart: there is no combined figure.
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
