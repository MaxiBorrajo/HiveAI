// Every formatter takes null for "the provider did not report it" and shows
// "—", never a zero.
export const NO_DATA = "—";

export function formatTokens(
  tokens: number | null,
  complete = true,
): string {
  if (tokens === null) return NO_DATA;
  return `${complete ? "" : "≥"}${tokens.toLocaleString()}`;
}

export function formatTokensPerSecond(value: number | null): string {
  if (value === null) return NO_DATA;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} tok/s`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return NO_DATA;
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Cached tokens are only worth a mention when there are some.
export function hasTokens(tokens: number | null): tokens is number {
  return tokens !== null && tokens > 0;
}

export function formatShare(share: number | null): string {
  if (share === null) return NO_DATA;
  return `${Math.round(share * 100)}%`;
}

// Input + output the providers reported; null when they reported neither.
export function pairTokens(pair: {
  inputTokens: number | null;
  outputTokens: number | null;
}): number | null {
  if (pair.inputTokens === null && pair.outputTokens === null) return null;
  return (pair.inputTokens ?? 0) + (pair.outputTokens ?? 0);
}
