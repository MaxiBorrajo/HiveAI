import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { reportSuccess } from "@/lib/toastManager";
import {
  cancelEvalRun,
  estimateEvalRun,
  exportEvalProfile,
  getModelEvalProfile,
  startEvalRun,
  type EvalJob,
  type EvalSuite,
  type MetricResult,
  type ModelEvalProfileResponse,
  type ProfileLevel,
  type RunEstimate,
} from "@/features/models/api/getModelEvalProfile";
import {
  choiceValue,
  parseChoiceValue,
  sameModel,
  type ModelChoice,
} from "@/features/models/lib/modelChoices";

const POLL_INTERVAL_MS = 2000;
const EVOLUTION_POINTS = 5;

const LEVEL_LABEL: Record<ProfileLevel, string> = {
  "very-good": "Very good",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

const LEVEL_VARIANT: Record<ProfileLevel, "default" | "secondary" | "outline" | "destructive"> = {
  "very-good": "default",
  good: "secondary",
  fair: "outline",
  poor: "destructive",
};

const SUITE_LABEL: Record<EvalSuite, string> = {
  routing: "Routing & extraction",
  generation: "Code / flow generation",
  execution: "Tool calling",
  summarization: "Summarization (judged)",
};

export interface JudgeChoice {
  choice: ModelChoice;
  label: string;
  /** Where it runs, e.g. "Local (Ollama)" or "Anthropic · work key". */
  group?: string;
}

function groupJudges(choices: JudgeChoice[]): [string, JudgeChoice[]][] {
  const byGroup = new Map<string, JudgeChoice[]>();
  for (const j of choices) {
    const key = j.group ?? "";
    byGroup.set(key, [...(byGroup.get(key) ?? []), j]);
  }
  return [...byGroup];
}

function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return "unknown";
  if (cost === 0) return "free";
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

export function EvalProfilePanel({
  model: modelProp,
  judgeChoices,
}: {
  /** The model being profiled. */
  model: ModelChoice;
  /** Models that can act as judge; the evaluated model itself is left out. */
  judgeChoices: JudgeChoice[];
}) {
  // Callers build the choice inline; keep one object per actual model so the
  // effects below don't refire on every parent render.
  const modelKey = choiceValue(modelProp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => modelProp, [modelKey]);
  const [data, setData] = useState<ModelEvalProfileResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getModelEvalProfile(model));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [model]);

  useEffect(() => {
    load();
  }, [load]);

  // While a run is going, keep refreshing so progress (and each suite's
  // results, saved as it finishes) show up without reopening the view.
  const running = data?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  if (loadError && !data) {
    return (
      <Section>
        <p className="text-xs text-destructive">Couldn't load the eval profile.</p>
        <Button variant="outline" size="sm" className="self-start" onClick={load}>
          Retry
        </Button>
      </Section>
    );
  }
  if (!data) {
    return (
      <Section>
        <p className="text-xs text-muted-foreground">Loading eval profile…</p>
      </Section>
    );
  }

  const metrics = Object.values(data.profile.latest);
  const candidates = judgeChoices.filter((j) => !sameModel(j.choice, model));

  return (
    <Section>
      {metrics.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Not evaluated yet. Evaluate it to see what this model is good and bad at.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {metrics.map((metric) => (
            <MetricRow
              key={metric.category}
              metric={metric}
              history={data.profile.history[metric.category] ?? [metric]}
              status={data.status[metric.category]}
            />
          ))}
        </div>
      )}

      {data.job && (
        <JobStatus
          job={data.job}
          onCancel={async () => {
            await cancelEvalRun(model);
            await load();
          }}
        />
      )}

      {formOpen && !running ? (
        <EvaluateForm
          model={model}
          suites={data.suites}
          judgeChoices={candidates}
          onClose={() => setFormOpen(false)}
          onStarted={async () => {
            setFormOpen(false);
            await load();
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={running} onClick={() => setFormOpen(true)}>
            <Play size={12} className="fill-current" />
            Evaluate
          </Button>
          {metrics.length > 0 && <ExportButtons model={model} />}
        </div>
      )}
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Eval profile" className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-semibold mb-3">Eval profile</p>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function MetricRow({
  metric,
  history,
  status,
}: {
  metric: MetricResult;
  history: MetricResult[];
  status?: { stale: boolean; reasons: string[]; judgeChangedSincePrevious: boolean };
}) {
  const points = history.slice(-EVOLUTION_POINTS);
  return (
    <div role="group" aria-label={metric.category} className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{metric.category}</span>
        <Badge variant={LEVEL_VARIANT[metric.level]}>
          {LEVEL_LABEL[metric.level]} · {pct(metric.value)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {metric.casesGraded} case{metric.casesGraded === 1 ? "" : "s"} graded
        {metric.casesUnjudged > 0 && `, ${metric.casesUnjudged} unjudged (not counted)`}
        {metric.judgeModel && ` · judge ${metric.judgeModel}`}
        {" · "}
        {formatCost(metric.costUsd)}
        {" · "}
        {new Date(metric.date).toLocaleDateString()}
      </p>
      {points.length > 1 && (
        <p className="text-xs text-muted-foreground" title="Evolution of this metric, oldest first">
          Evolution: {points.map((p) => pct(p.value)).join(" → ")}
          {status?.judgeChangedSincePrevious && " (judge changed in the last run)"}
        </p>
      )}
      {metric.lowConfidence && (
        <p className="text-xs text-amber-600 dark:text-amber-500">Low confidence — based on few cases.</p>
      )}
      {status?.stale && (
        <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Out of date: {status.reasons.join("; ")}. Evaluate again to refresh it.
        </p>
      )}
    </div>
  );
}

function JobStatus({ job, onCancel }: { job: EvalJob; onCancel: () => void }) {
  if (job.status === "running") {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 text-xs">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          <span>
            Evaluating
            {job.current
              ? ` ${job.current.suite} · case ${job.current.index + 1}/${job.current.total}: ${job.current.name}`
              : "…"}
          </span>
        </div>
        {job.savedSuites.length > 0 && (
          <span className="text-muted-foreground">Saved so far: {job.savedSuites.join(", ")}</span>
        )}
        <Button variant="destructive" size="sm" className="self-start" onClick={onCancel}>
          <Square size={12} className="fill-current" />
          Cancel
        </Button>
      </div>
    );
  }

  const saved = job.savedSuites.length > 0 ? ` Saved: ${job.savedSuites.join(", ")}.` : "";
  const message = {
    succeeded: `Evaluation finished.${saved}`,
    cancelled: `Evaluation cancelled.${saved} Unfinished categories kept their previous results.`,
    failed: `Evaluation failed: ${job.log.at(-1) ?? "unknown error"}.${saved}`,
  }[job.status];
  return (
    <div role="status" className={`text-xs ${job.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
      <p>{message}</p>
      {job.skipped.map((s) => (
        <p key={s.suite}>
          Skipped {s.suite}: {s.reason}
        </p>
      ))}
    </div>
  );
}

function EvaluateForm({
  model,
  suites,
  judgeChoices,
  onClose,
  onStarted,
}: {
  model: ModelChoice;
  suites: ModelEvalProfileResponse["suites"];
  judgeChoices: JudgeChoice[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const [selected, setSelected] = useState<EvalSuite[]>(suites.map((s) => s.suite));
  const [judgeValue, setJudgeValue] = useState("");
  const [estimate, setEstimate] = useState<RunEstimate | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [starting, setStarting] = useState(false);

  const needsJudge = suites.some((s) => s.needsJudge && selected.includes(s.suite));
  const judge = needsJudge ? parseChoiceValue(judgeValue) : undefined;
  const missingJudge = needsJudge && !judge;

  // Re-estimate whenever what would run changes; a stale answer from an
  // earlier selection is dropped.
  const requestId = useRef(0);
  useEffect(() => {
    setAccepted(false);
    if (selected.length === 0 || missingJudge) {
      setEstimate(null);
      return;
    }
    const id = ++requestId.current;
    estimateEvalRun({ executor: model, judge, suites: selected })
      .then((result) => id === requestId.current && setEstimate(result))
      .catch(() => id === requestId.current && setEstimate(null));
    // `judge` is derived from judgeValue, which is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, judgeValue, selected, missingJudge]);

  const needsConfirmation = !!estimate?.requiresConfirmation;
  const canStart =
    selected.length > 0 && !missingJudge && !!estimate && (!needsConfirmation || accepted) && !starting;

  async function start() {
    setStarting(true);
    try {
      const job = await startEvalRun({ executor: model, judge, suites: selected, confirm: accepted });
      if (job) onStarted();
    } catch {
      // The API client already shows the error.
    } finally {
      setStarting(false);
    }
  }

  const toggle = (suite: EvalSuite) =>
    setSelected((prev) => (prev.includes(suite) ? prev.filter((s) => s !== suite) : [...prev, suite]));

  return (
    <form
      aria-label="Evaluate model"
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canStart) start();
      }}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium mb-1">Categories to evaluate</legend>
        {suites.map((s) => (
          <label key={s.suite} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={selected.includes(s.suite)}
              onChange={() => toggle(s.suite)}
            />
            {SUITE_LABEL[s.suite]}
            <span className="text-muted-foreground">({s.categories.join(", ")})</span>
          </label>
        ))}
      </fieldset>

      {needsJudge && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Judge model</span>
          <span className="text-muted-foreground">
            Summarization has no single right answer, so another model reads each answer and
            scores it from 0 to 100 (passes at 70). Pick a model other than the one being evaluated.
          </span>
          <select
            value={judgeValue}
            onChange={(e) => setJudgeValue(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Choose a judge…</option>
            {groupJudges(judgeChoices).map(([group, choices]) => {
              const options = choices.map((j) => (
                <option key={choiceValue(j.choice)} value={choiceValue(j.choice)}>
                  {j.label}
                </option>
              ));
              return group ? (
                <optgroup key={group} label={group}>
                  {options}
                </optgroup>
              ) : (
                <Fragment key="">{options}</Fragment>
              );
            })}
          </select>
        </label>
      )}

      {selected.length > 0 && !missingJudge && (
        <p className="text-xs" aria-live="polite">
          {estimate
            ? `Estimated cost: ${formatCost(estimate.totalCostUsd)} · ${estimate.suites.reduce((n, s) => n + s.cases, 0)} cases`
            : "Estimating…"}
        </p>
      )}

      {needsConfirmation && (
        <label className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-500">
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 accent-primary"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          This uses a cloud model and makes real, paid API calls. I accept the estimated cost.
        </label>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!canStart}>
          {starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />}
          Start evaluation
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </form>
  );
}

function ExportButtons({ model }: { model: ModelChoice }) {
  async function exportAs(format: "md" | "html" | "json") {
    try {
      const path = await exportEvalProfile(model, format);
      if (path) reportSuccess("Profile exported", path);
    } catch {
      // The API client already shows the error.
    }
  }
  return (
    <>
      {(["md", "html", "json"] as const).map((format) => (
        <Button key={format} variant="outline" size="sm" onClick={() => exportAs(format)}>
          <Download size={12} />
          Export {format.toUpperCase()}
        </Button>
      ))}
    </>
  );
}
