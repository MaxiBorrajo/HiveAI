export interface TokenSavingsConfig {
  /** Anthropic: ask for automatic prompt caching (top-level cache_control). */
  promptCaching: boolean;
  /**
   * Gemini: explicit context cache for system prompt + tools. Off by default
   * until verified against the live API (Gemini already caches implicitly).
   */
  geminiContextCache: boolean;
  /** Replace already-consumed old tool results with a short marker. */
  deterministicCompaction: boolean;
  /** Summarize old history with a small model when it is still too big. */
  llmSummary: boolean;
  /** Chat: do not request thinking on follow-up iterations of a tool loop. */
  thinkingControl: boolean;
  /** Executions: refuse identical tool calls repeated within one node run. */
  dedupToolCalls: boolean;
  /** Use the provider's small model for auxiliary tasks (naming, clarification). */
  smallModelForAux: boolean;
  /** Executions/chat: cap what is replayed into the request. */
  boundedReplay: boolean;

  geminiCacheTtlSeconds: number;
  /** Prefixes smaller than this are not worth an explicit Gemini cache. */
  geminiCacheMinChars: number;
  /** Estimated size (chars) above which compaction starts acting. */
  compactionTriggerChars: number;
  /** Tool results below this size are never replaced. */
  compactionMinResultChars: number;
  /** Most recent consumed tool results that stay complete. */
  keepRecentToolResults: number;
  /** Estimated size (chars) above which the LLM summary starts acting. */
  summaryTriggerChars: number;
  /** Older history smaller than this is not worth summarizing. */
  summaryMinHistoryChars: number;
  /** Max messages of state.messages replayed into an execution node. */
  replayMaxMessages: number;
  /** Older assistant messages longer than this are trimmed in chat history. */
  replayOldMessageMaxChars: number;
}

export const DEFAULT_TOKEN_SAVINGS: TokenSavingsConfig = {
  promptCaching: true,
  geminiContextCache: false,
  deterministicCompaction: true,
  llmSummary: true,
  thinkingControl: true,
  dedupToolCalls: true,
  smallModelForAux: true,
  boundedReplay: true,

  geminiCacheTtlSeconds: 600,
  geminiCacheMinChars: 8_000,
  compactionTriggerChars: 40_000,
  compactionMinResultChars: 1_500,
  keepRecentToolResults: 3,
  summaryTriggerChars: 160_000,
  summaryMinHistoryChars: 16_000,
  replayMaxMessages: 40,
  replayOldMessageMaxChars: 6_000,
};

export const ALL_OFF: TokenSavingsConfig = {
  ...DEFAULT_TOKEN_SAVINGS,
  promptCaching: false,
  geminiContextCache: false,
  deterministicCompaction: false,
  llmSummary: false,
  thinkingControl: false,
  dedupToolCalls: false,
  smallModelForAux: false,
  boundedReplay: false,
};

export type TokenSavingsOverride = Partial<TokenSavingsConfig> | false;

let globalDefaults: TokenSavingsConfig = DEFAULT_TOKEN_SAVINGS;

/** Process-wide defaults. Pass `false` to disable everything; `undefined` resets. */
export function setTokenSavingsDefaults(
  override: TokenSavingsOverride | undefined,
): void {
  globalDefaults = override === undefined
    ? DEFAULT_TOKEN_SAVINGS
    : resolve(DEFAULT_TOKEN_SAVINGS, override);
}

export function resolveTokenSavings(
  override?: TokenSavingsOverride,
): TokenSavingsConfig {
  return resolve(globalDefaults, override);
}

function resolve(
  base: TokenSavingsConfig,
  override?: TokenSavingsOverride,
): TokenSavingsConfig {
  if (override === false) return ALL_OFF;
  return override ? { ...base, ...override } : base;
}
