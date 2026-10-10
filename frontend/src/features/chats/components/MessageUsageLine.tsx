import {
  formatDuration,
  formatTokens,
  formatTokensPerSecond,
  hasTokens,
  NO_DATA,
} from "../lib/formatUsage.ts";
import type { MessageUsage } from "../types.ts";
import { UsageLocationIcon } from "./UsageLocationIcon.tsx";

// Consumption of one response, summed over every model call made for it.
// `usage` null means nothing was recorded (an older message): dashes, not zeros.
export function MessageUsageLine({ usage }: { usage: MessageUsage | null }) {
  const complete = usage?.tokensComplete ?? true;

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
      <span>in {formatTokens(usage?.inputTokens ?? null, complete)}</span>
      <span>· out {formatTokens(usage?.outputTokens ?? null, complete)}</span>
      {usage && hasTokens(usage.cacheReadTokens) && (
        <span>· cache read {formatTokens(usage.cacheReadTokens)}</span>
      )}
      {usage && hasTokens(usage.cacheWriteTokens) && (
        <span>· cache write {formatTokens(usage.cacheWriteTokens)}</span>
      )}
      <span>· {formatTokensPerSecond(usage?.tokensPerSecond ?? null)}</span>
      <span>· first token {formatDuration(usage?.ttftMs ?? null)}</span>
      <span>· total {formatDuration(usage?.latencyMs ?? null)}</span>
      {usage?.failedCalls ? (
        <span className="text-destructive">
          · {usage.failedCalls} failed call{usage.failedCalls === 1 ? "" : "s"}
        </span>
      ) : null}
      {usage ? (
        usage.models.map((m) => (
          <span
            key={`${m.provider}/${m.model}`}
            className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px"
          >
            <UsageLocationIcon location={m.location} />
            {m.model}
          </span>
        ))
      ) : (
        <span>· model {NO_DATA}</span>
      )}
    </div>
  );
}
