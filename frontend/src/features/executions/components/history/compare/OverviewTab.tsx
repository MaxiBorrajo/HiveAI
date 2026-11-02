import { TrophyIcon } from "lucide-react";
import { formatDuration, formatTokens, NO_DATA } from "@/lib/formatUsage";
import type { RunScore } from "../../../lib/compareRunSet";
import type { RunSummary } from "../../../types";
import { RunColumns, runLabel } from "./shared";

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

export function OverviewTab({ scores }: { scores: RunScore[] }) {
  return (
    <RunColumns count={scores.length}>
      {scores.map((score) => (
        <OverviewCard key={score.run.historyId} score={score} />
      ))}
    </RunColumns>
  );
}
