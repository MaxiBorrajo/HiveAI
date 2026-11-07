import { UsageLocationIcon } from "@/components/UsageLocationIcon";
import { formatTokens, NO_DATA } from "@/lib/formatUsage";
import { PROVIDER_LABELS } from "@/features/models/lib/modelChoices";
import type { RunModel, TokenPair } from "@/lib/usage";
import type { RunSummary } from "../../../types";

export const providerLabel = (provider: string) =>
  (PROVIDER_LABELS as Record<string, string>)[provider] ?? provider;

export function formatDelta(a: number | null, b: number | null): string | null {
  if (a === null || b === null) return null;
  const change = b - a;
  if (change === 0) return "no change";
  const sign = change > 0 ? "+" : "−";
  const pct = a > 0 ? ` (${sign}${Math.round((Math.abs(change) / a) * 100)}%)` : "";
  return `${sign}${Math.abs(change).toLocaleString()}${pct}`;
}

export function runLabel(run: RunSummary) {
  return `#${run.iteration} · ${new Date(run.createdAt).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="font-heading text-sm font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function TwoColumns({
  left,
  right,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="min-w-0">{left}</div>
      <div className="min-w-0">{right}</div>
    </div>
  );
}

export function RunColumns({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 md:[grid-template-columns:var(--cols)]"
      style={
        { "--cols": `repeat(${count}, minmax(0, 1fr))` } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

export function ModelLabel({ model }: { model: RunModel | null }) {
  if (!model) {
    return <span className="text-xs text-muted-foreground">{NO_DATA}</span>;
  }
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 break-all font-mono text-xs">
        <UsageLocationIcon location={model.location} />
        {model.model}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {providerLabel(model.provider)}
        {model.keyAlias ? ` · key "${model.keyAlias}"` : ""}
      </span>
    </span>
  );
}

export function TokenPairText({ pair }: { pair: TokenPair }) {
  return (
    <span className="font-mono text-xs">
      in {formatTokens(pair.inputTokens)} · out {formatTokens(pair.outputTokens)}
    </span>
  );
}
