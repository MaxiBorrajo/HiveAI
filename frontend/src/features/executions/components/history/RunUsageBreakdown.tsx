import { AlertCircleIcon } from "lucide-react";
import { UsageLocationIcon } from "@/components/UsageLocationIcon";
import {
  formatDuration,
  formatShare,
  formatTokens,
  formatTokensPerSecond,
  hasTokens,
  NO_DATA,
  pairTokens,
} from "@/lib/formatUsage";
import type {
  RunBucket,
  RunCall,
  RunModel,
  RunNodeUsage,
  RunUsage,
  UsageLocation,
} from "@/lib/usage";

const PROVIDER_LABELS: Record<string, string> = {
  ollama: "Ollama",
  anthropic: "Anthropic",
  google: "Google Gemini",
};

function ModelChip({
  model,
  location,
}: {
  model: string;
  location: UsageLocation;
}) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs text-foreground break-all">
      <UsageLocationIcon location={location} />
      {model}
    </span>
  );
}

function Tokens({
  input,
  output,
  cacheRead,
  cacheWrite,
  complete = true,
}: {
  input: number | null;
  output: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  complete?: boolean;
}) {
  return (
    <span>
      in {formatTokens(input, complete)} · out {formatTokens(output, complete)}
      {hasTokens(cacheRead ?? null) &&
        ` · cache read ${formatTokens(cacheRead ?? null)}`}
      {hasTokens(cacheWrite ?? null) &&
        ` · cache write ${formatTokens(cacheWrite ?? null)}`}
    </span>
  );
}

function Fact({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs text-foreground">{value}</span>
      {hint && (
        <span className="text-[10px] leading-snug text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}

function BucketSection({
  location,
  bucket,
}: {
  location: UsageLocation;
  bucket: RunBucket;
}) {
  if (bucket.calls === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <h4 className="flex items-center gap-1.5 text-sm font-medium">
          <UsageLocationIcon location={location} className="size-3.5" />
          {location === "cloud" ? "Cloud" : "Local"}
        </h4>
        <p className="font-mono text-xs text-muted-foreground">
          <Tokens
            input={bucket.inputTokens}
            output={bucket.outputTokens}
            cacheRead={bucket.cacheReadTokens}
            cacheWrite={bucket.cacheWriteTokens}
            complete={bucket.tokensComplete}
          />{" "}
          · {bucket.calls} call{bucket.calls === 1 ? "" : "s"}
          {bucket.failedCalls > 0 && (
            <span className="text-destructive">
              {" "}
              ({bucket.failedCalls} failed)
            </span>
          )}
        </p>
      </div>
      <ul className="flex flex-col gap-4">
        {bucket.models.map((m) => (
          <li
            key={`${m.provider}/${m.model}`}
            className="flex flex-col gap-1.5 border-l-2 border-border py-0.5 pl-3"
          >
            <ModelChip model={m.model} location={m.location} />
            <span className="text-[10px] text-muted-foreground">
              {PROVIDER_LABELS[m.provider] ?? m.provider}
              {m.keyAliases.length > 0 && ` · key ${m.keyAliases.join(", ")}`}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              <Tokens
                input={m.inputTokens}
                output={m.outputTokens}
                cacheRead={m.cacheReadTokens}
                cacheWrite={m.cacheWriteTokens}
                complete={m.tokensComplete}
              />{" "}
              · {formatTokensPerSecond(m.tokensPerSecond)} · {m.calls} call
              {m.calls === 1 ? "" : "s"}
              {m.failedCalls > 0 && (
                <span className="text-destructive">
                  {" "}
                  ({m.failedCalls} failed)
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CallLine({ call }: { call: RunCall }) {
  const failed = call.status === "error";
  return (
    <li
      className={`flex flex-col gap-1 border-l-2 py-0.5 pl-3 ${
        failed ? "border-destructive" : "border-border"
      }`}
    >
      <span className="flex flex-wrap items-center gap-x-1.5 font-mono text-[10px]">
        <ModelChip model={call.model} location={call.location} />
        {call.keyAlias && (
          <span className="text-muted-foreground">· key {call.keyAlias}</span>
        )}
      </span>
      <span
        className={`font-mono text-[10px] ${
          failed ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {failed ? (
          <span className="inline-flex items-center gap-1">
            <AlertCircleIcon className="size-3 shrink-0" />
            failed{call.errorType ? ` (${call.errorType})` : ""} ·{" "}
            {formatDuration(call.durationMs)}
          </span>
        ) : (
          <>
            <Tokens
              input={call.inputTokens}
              output={call.outputTokens}
              cacheRead={call.cacheReadTokens}
              cacheWrite={call.cacheWriteTokens}
            />{" "}
            · {formatDuration(call.durationMs)}
          </>
        )}
      </span>
    </li>
  );
}

function ConfiguredModel({ model }: { model: RunModel }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
      <ModelChip model={model.model} location={model.location} />
      <span>
        {PROVIDER_LABELS[model.provider] ?? model.provider}
        {model.keyAlias && ` · key ${model.keyAlias}`}
      </span>
    </span>
  );
}

function NodeSection({ node }: { node: RunNodeUsage }) {
  return (
    <li className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground">
          {node.nodeName}
          {node.nodeType && (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {node.nodeType}
            </span>
          )}
        </span>
        {node.configuredModel ? (
          <ConfiguredModel model={node.configuredModel} />
        ) : null}
      </div>
      {node.calls.length === 0 ? (
        <span className="text-[10px] text-muted-foreground">
          No model calls
        </span>
      ) : (
        <ul className="flex flex-col gap-3">
          {node.calls.map((call, i) => (
            <CallLine key={i} call={call} />
          ))}
        </ul>
      )}
    </li>
  );
}

// What one run consumed. `usage` null means nothing was recorded (the run
// predates usage tracking): that is "no data", not zeros.
export function RunUsageBreakdown({ usage }: { usage: RunUsage | null }) {
  if (!usage) {
    return (
      <p className="text-xs text-muted-foreground">
        No usage data. This run happened before consumption was recorded.
      </p>
    );
  }

  const { delegation } = usage;
  const designed = pairTokens(delegation.orchestrator);
  const delegated = pairTokens(delegation.delegated);
  const local = pairTokens(delegation.local);

  return (
    <div className="flex flex-col gap-7">
      <div className="grid grid-cols-3 gap-4">
        <Fact
          label="Total time"
          value={formatDuration(usage.latencyMs)}
          hint="Start to finish, waits included"
        />
        <Fact label="Model calls" value={usage.calls} />
        <Fact
          label="Failed"
          value={
            <span className={usage.failedCalls > 0 ? "text-destructive" : ""}>
              {usage.failedCalls}
            </span>
          }
        />
      </div>

      <section className="flex flex-col gap-3">
        <h4 className="text-sm font-medium">Orchestrator</h4>
        <div className="flex flex-col gap-1.5 border-l-2 border-border py-0.5 pl-3">
            {usage.orchestrator ? (
              <>
                <ConfiguredModel model={usage.orchestrator} />
                <span className="text-[10px] leading-snug text-muted-foreground">
                  {usage.orchestrator.source === "generation"
                    ? "Generated this graph."
                    : "Assumed from the chat's model at run time: this graph did not record which model generated it."}
                </span>
              </>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {NO_DATA} It is not known which model generated this graph.
              </span>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              {delegation.orchestratorCalls > 0 ? (
                <>
                  Designing the graph:{" "}
                  <Tokens
                    input={delegation.orchestrator.inputTokens}
                    output={delegation.orchestrator.outputTokens}
                  />{" "}
                  · {delegation.orchestratorCalls} call
                  {delegation.orchestratorCalls === 1 ? "" : "s"}
                </>
              ) : (
                `Designing the graph: ${NO_DATA} (not recorded for this graph)`
              )}
            </span>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium">Delegated work</h4>
          <span className="text-[10px] leading-snug text-muted-foreground">
            What the nodes of this run consumed, by where each model ran.
          </span>
        </div>
        <BucketSection location="local" bucket={usage.local} />
        <BucketSection location="cloud" bucket={usage.cloud} />
        {usage.calls === 0 && (
          <p className="text-xs text-muted-foreground">
            This run made no model calls ({NO_DATA} tokens).
          </p>
        )}
      </section>

      {usage.calls > 0 && (
        <section className="flex flex-col gap-2 rounded-md bg-muted/50 p-4">
          <h4 className="text-sm font-medium">Delegation</h4>
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            Delegated to nodes {formatTokens(delegated)} tokens · Orchestrator
            (designing the graph) {formatTokens(designed)} tokens
          </p>
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            {formatShare(delegation.delegatedShare)} of those tokens were
            delegated
          </p>
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            Of the delegated work, {formatTokens(local)} tokens (
            {formatShare(delegation.localShare)}) ran on local models
          </p>
        </section>
      )}

      {usage.nodes.length > 0 && (
        <section className="flex flex-col gap-4">
          <h4 className="text-sm font-medium">By node</h4>
          <ul className="flex flex-col gap-6">
            {usage.nodes.map((node) => (
              <NodeSection key={node.nodeId ?? "unattributed"} node={node} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
