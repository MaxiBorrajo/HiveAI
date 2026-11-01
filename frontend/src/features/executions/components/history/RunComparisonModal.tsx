import { useMemo } from "react";
import { InfoIcon, TrophyIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UsageLocationIcon } from "@/components/UsageLocationIcon";
import { downloadFile, stringifyContent } from "@/lib/download";
import {
  formatDuration,
  formatTokens,
  NO_DATA,
  pairTokens,
} from "@/lib/formatUsage";
import { PROVIDER_LABELS } from "@/features/models/lib/modelChoices";
import type { RunModel, TokenPair } from "@/lib/usage";
import { FileArtifactCard } from "../result/FileArtifactCard";
import { ResultRenderer } from "../result/ResultRenderer";
import { normalizeResult } from "../../lib/executionResult";
import {
  compareRuns,
  type HeadlineSide,
  type ModelRow,
  type NodeRow,
  type NodeSide,
} from "../../lib/compareRuns";
import {
  compareRunSet,
  type RunScore,
} from "../../lib/compareRunSet";
import type { ExecutionFileArtifact, RunSummary } from "../../types";
import { JudgePanel } from "./JudgePanel";

const providerLabel = (provider: string) =>
  (PROVIDER_LABELS as Record<string, string>)[provider] ?? provider;

function formatDelta(a: number | null, b: number | null): string | null {
  if (a === null || b === null) return null;
  const change = b - a;
  if (change === 0) return "no change";
  const sign = change > 0 ? "+" : "−";
  const pct = a > 0 ? ` (${sign}${Math.round((Math.abs(change) / a) * 100)}%)` : "";
  return `${sign}${Math.abs(change).toLocaleString()}${pct}`;
}

function runLabel(run: RunSummary) {
  return `#${run.iteration} · ${new Date(run.createdAt).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
}

function Section({
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

function TwoColumns({
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

function ModelLabel({ model }: { model: RunModel | null }) {
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

function TokenPairText({ pair }: { pair: TokenPair }) {
  return (
    <span className="font-mono text-xs">
      in {formatTokens(pair.inputTokens)} · out {formatTokens(pair.outputTokens)}
    </span>
  );
}

function HeadlineCard({
  run,
  side,
}: {
  run: RunSummary;
  side: HeadlineSide | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <div className="font-mono text-xs font-medium">{runLabel(run)}</div>
      {!side ? (
        <p className="text-xs text-muted-foreground">No usage data</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Orchestrator
            </span>
            <ModelLabel model={side.orchestrator} />
            <TokenPairText pair={side.orchestratorTokens} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Delegated
            </span>
            <TokenPairText pair={side.delegated} />
            <span className="text-[10px] text-muted-foreground">
              local: {formatTokens(pairTokens(side.delegatedLocal))} · cloud:{" "}
              {formatTokens(pairTokens(side.delegatedCloud))}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {formatDuration(side.latencyMs)} total · {side.calls} call
            {side.calls === 1 ? "" : "s"}
            {side.failedCalls > 0 && (
              <span className="text-destructive">
                {" "}
                · {side.failedCalls} failed
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ResultColumn({ run }: { run: RunSummary }) {
  const result = normalizeResult(run.result);
  const download = (file: ExecutionFileArtifact) =>
    downloadFile(file.name, stringifyContent(result.content));
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="font-mono text-xs font-medium">{runLabel(run)}</div>
      {result.files && result.files.length > 0 && (
        <div className="flex flex-col gap-2">
          {result.files.map((file, i) => (
            <FileArtifactCard
              key={i}
              file={file}
              onDownload={() => download(file)}
            />
          ))}
        </div>
      )}
      <div className="max-h-96 overflow-auto">
        <ResultRenderer result={result} />
      </div>
    </div>
  );
}

const STATE_LABEL: Record<NodeRow["state"], string | null> = {
  same: null,
  modelChanged: "Model changed",
  onlyInA: "Only in the left run",
  onlyInB: "Only in the right run",
};

function NodeCell({ side }: { side: NodeSide | null }) {
  if (!side) {
    return (
      <span className="text-xs text-muted-foreground">Not in this run</span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      {side.nodeType === "llm" || side.model ? (
        <ModelLabel model={side.model} />
      ) : (
        <span className="text-xs text-muted-foreground">No model</span>
      )}
      <span className="font-mono text-[10px] text-muted-foreground">
        {side.calls > 0
          ? `in ${formatTokens(side.tokens.inputTokens)} · out ${formatTokens(side.tokens.outputTokens)} · ${formatDuration(side.latencyMs)}`
          : "not timed"}
      </span>
    </span>
  );
}

function NodesTable({ rows }: { rows: NodeRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No node data to compare.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground md:grid">
        <span>Node</span>
        <span>Left run</span>
        <span>Right run</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row, i) => {
          const ref = (row.a ?? row.b)!;
          const label = STATE_LABEL[row.state];
          return (
            <li
              key={i}
              className={`grid grid-cols-1 gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] md:gap-3 ${
                row.state === "same" ? "" : "bg-muted/40"
              }`}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-xs font-medium">
                  {ref.nodeName}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {ref.nodeType ?? "node"}
                  {row.matchedBy === "name" && " · matched by name"}
                </span>
                {label && (
                  <span className="w-fit rounded border border-border px-1.5 py-0.5 text-[10px] font-medium">
                    {label}
                  </span>
                )}
              </span>
              <NodeCell side={row.a} />
              <NodeCell side={row.b} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TokenCell({
  totals,
}: {
  totals: ModelRow["a"];
}) {
  if (!totals) {
    return <span className="text-xs text-muted-foreground">Not used</span>;
  }
  return (
    <span className="flex flex-col gap-0.5 font-mono text-xs">
      <span>
        in {formatTokens(totals.inputTokens, totals.tokensComplete)} · out{" "}
        {formatTokens(totals.outputTokens, totals.tokensComplete)}
      </span>
      <span className="text-[10px] text-muted-foreground">
        cached {formatTokens(totals.cacheReadTokens)} ·{" "}
        {totals.keyAliases.length > 0
          ? `key ${totals.keyAliases.map((a) => `"${a}"`).join(", ")}`
          : "no key"}
      </span>
    </span>
  );
}

function ModelsTable({ rows }: { rows: ModelRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No model usage to compare.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const location = (row.a ?? row.b)!.location;
        return (
          <li
            key={`${row.provider}/${row.model}`}
            className="flex flex-col gap-2 rounded-md border border-border p-3"
          >
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              <UsageLocationIcon location={location} />
              {row.model}
              <span className="font-sans text-[10px] text-muted-foreground">
                {providerLabel(row.provider)}
              </span>
            </span>
            <TwoColumns
              left={<TokenCell totals={row.a} />}
              right={<TokenCell totals={row.b} />}
            />
            {row.a && row.b ? (
              <p className="font-mono text-[10px] text-muted-foreground">
                Δ in {formatDelta(row.a.inputTokens, row.b.inputTokens) ?? NO_DATA}
                {" · "}Δ out{" "}
                {formatDelta(row.a.outputTokens, row.b.outputTokens) ?? NO_DATA}
                {row.approximate && " · some calls did not report tokens"}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Only one run used this model, so there is nothing to set it
                against.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const columnsStyle = (count: number) => ({
  gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
});

function RunColumns({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 md:[grid-template-columns:var(--cols)]"
      style={{ "--cols": columnsStyle(count).gridTemplateColumns } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function totalTokens(run: RunSummary): number | null {
  const buckets = run.usage ? [run.usage.local, run.usage.cloud] : [];
  const values = buckets.flatMap((b) => [b.inputTokens, b.outputTokens]);
  const reported = values.filter((v): v is number => v !== null);
  return reported.length === 0 ? null : reported.reduce((x, y) => x + y, 0);
}

function modelNames(run: RunSummary): string[] {
  const usage = run.usage;
  if (!usage) return [];
  const names = [
    usage.orchestrator ? usage.orchestrator.model : null,
    ...[...usage.local.models, ...usage.cloud.models].map((m) => m.model),
  ].filter((n): n is string => n !== null);
  return [...new Set(names)];
}

function GradeBlock({ score }: { score: RunScore }) {
  const { grade } = score;
  if (!grade) {
    return <p className="text-xs text-muted-foreground">Not graded</p>;
  }
  if (grade.status === "failed" || grade.score === null) {
    return (
      <div className="flex flex-col gap-1">
        <span className="w-fit rounded border border-border px-1.5 py-0.5 text-[10px] font-medium">
          Unevaluated
        </span>
        <p className="text-[10px] text-muted-foreground">
          The judge failed{grade.error ? `: ${grade.error}` : "."}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg font-medium">{grade.score}/10</span>
        {score.isBest && <TrophyIcon className="size-3.5" aria-label="Best score" />}
        {score.behindBest !== null && (
          <span className="font-mono text-[10px] text-muted-foreground">
            −{score.behindBest} vs best
          </span>
        )}
      </div>
      <p className="text-xs">{grade.reasoning}</p>
      <p className="text-[10px] text-muted-foreground">
        {grade.judge.model} · judge v{grade.judge.version} · rubric v
        {grade.rubric.version}
      </p>
    </div>
  );
}

function OverviewCard({ score }: { score: RunScore }) {
  const { run } = score;
  const models = modelNames(run);
  const input = Object.entries(run.input ?? {}).filter(
    ([, v]) => v !== undefined && v !== "",
  );
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <div className="font-mono text-xs font-medium">{runLabel(run)}</div>
      <dl className="flex flex-col gap-2 text-xs">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</dt>
          <dd>Completed</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Model</dt>
          <dd className="break-all font-mono">{models.length > 0 ? models.join(", ") : NO_DATA}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Tokens</dt>
          <dd className="font-mono">{formatTokens(totalTokens(run))}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Time</dt>
          <dd className="font-mono">{formatDuration(run.usage?.latencyMs ?? null)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Input</dt>
          <dd className="max-h-24 overflow-auto break-words">
            {run.input === null
              ? "Not recorded"
              : input.length === 0
                ? "Empty"
                : input.map(([k, v]) => (
                    <div key={k}>
                      <span className="font-mono text-muted-foreground">{k}: </span>
                      {typeof v === "string" ? v : JSON.stringify(v)}
                    </div>
                  ))}
          </dd>
        </div>
      </dl>
      <div className="border-t border-border pt-2">
        <GradeBlock score={score} />
      </div>
    </div>
  );
}

export function RunComparisonModal({
  executionId,
  runs,
  open,
  onOpenChange,
  onGraded,
}: {
  executionId: string | null;
  runs: RunSummary[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGraded: () => void;
}) {
  const set = useMemo(() => (runs ? compareRunSet(runs) : null), [runs]);
  const pair = runs && runs.length === 2 ? runs : null;
  const comparison = useMemo(
    () => (pair ? compareRuns(pair[0], pair[1]) : null),
    [pair],
  );
  const pairWarnings = (comparison?.warnings ?? []).filter(
    (w) => w.code !== "differentInput" && w.code !== "inputNotRecorded",
  );
  const warnings = [...(set?.warnings ?? []), ...pairWarnings.map((w) => w.message)];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Compare runs</DialogTitle>
          <DialogDescription>
            Side by side. Grading with a judge is optional: read the results
            and decide, or ask a judge model to score them.
          </DialogDescription>
        </DialogHeader>

        {runs && set && (
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
            <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
              These are tokens, not prices. Different models are shown side by
              side and are never added into a single figure. Ask the judge to
              look up prices if you want a cost comparison.
            </p>

            {warnings.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {warnings.map((message, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden>•</span>
                    {message}
                  </li>
                ))}
              </ul>
            )}

            <Section
              title="Overview"
              hint="Input, model, tokens, time, status and the judge's score for each run."
            >
              <RunColumns count={runs.length}>
                {set.scores.map((score) => (
                  <OverviewCard key={score.run.historyId} score={score} />
                ))}
              </RunColumns>
            </Section>

            {pair && comparison && (
              <Section
                title="Main metric"
                hint="Tokens of the orchestrator and tokens delegated to the nodes."
              >
                <TwoColumns
                  left={<HeadlineCard run={pair[0]} side={comparison.a} />}
                  right={<HeadlineCard run={pair[1]} side={comparison.b} />}
                />
                {comparison.a && comparison.b && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {comparison.orchestratorDelta
                      ? `Same orchestrator model · Δ in ${
                          formatDelta(
                            comparison.a.orchestratorTokens.inputTokens,
                            comparison.b.orchestratorTokens.inputTokens,
                          ) ?? NO_DATA
                        } · Δ out ${
                          formatDelta(
                            comparison.a.orchestratorTokens.outputTokens,
                            comparison.b.orchestratorTokens.outputTokens,
                          ) ?? NO_DATA
                        }`
                      : "Different or unknown orchestrator models: tokens are not set against each other."}
                  </p>
                )}
              </Section>
            )}

            <Section title="Result">
              <RunColumns count={runs.length}>
                {runs.map((run) => (
                  <div key={run.historyId} className="min-w-0">
                    <ResultColumn run={run} />
                  </div>
                ))}
              </RunColumns>
            </Section>

            {executionId && (
              <Section
                title="Judge"
                hint="Score the runs with a rubric you write, or ask the judge questions."
              >
                <JudgePanel
                  executionId={executionId}
                  runs={runs}
                  onGraded={onGraded}
                />
              </Section>
            )}

            {pair && comparison && (
              <>
                <Section
                  title="Nodes"
                  hint={`${comparison.nodeCounts.matched} matched · ${comparison.nodeCounts.onlyInA} only in the left run · ${comparison.nodeCounts.onlyInB} only in the right run`}
                >
                  <NodesTable rows={comparison.nodes} />
                </Section>

                <Section
                  title="Tokens by model"
                  hint="Variation is shown only when the same model ran in both runs."
                >
                  <ModelsTable rows={comparison.models} />
                </Section>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
