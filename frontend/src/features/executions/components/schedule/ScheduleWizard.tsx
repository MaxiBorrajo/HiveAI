import { useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { getErrorMessage } from "@/lib/errors";
import { previewSchedule } from "../../api/schedules";
import {
  DAY_LABELS,
  HOUR_STEPS,
  MINUTE_STEPS,
  MODE_LABEL,
  STEP_TITLE,
  applyMode,
  canAdvance,
  describeCron,
  describeSchedule,
  isDraftValid,
  modeOf,
  toggleDay,
  wizardSteps,
  type ScheduleMode,
  type WizardStep,
} from "../../lib/schedule";
import type { BackgroundSettings, ScheduleDraft } from "../../types";

const when = (ms: number) =>
  new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

const SELECT = "h-8 rounded-md border border-input bg-background px-2 text-sm";

interface ScheduleWizardProps {
  initial: ScheduleDraft;
  /** New schedule (all steps) or an edit (just when/input). */
  creating: boolean;
  inputRequired: boolean;
  background: BackgroundSettings | null;
  onChangeBackground: (patch: Partial<BackgroundSettings>) => void;
  onSubmit: (draft: ScheduleDraft) => Promise<void>;
  onCancel: () => void;
}

function WhenStep({
  draft,
  setDraft,
  onProblem,
}: {
  draft: ScheduleDraft;
  setDraft: (draft: ScheduleDraft) => void;
  onProblem: (problem: string | null) => void;
}) {
  const initialMode = useMemo(() => modeOf(draft), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<ScheduleMode>(initialMode.mode);
  const [every, setEvery] = useState(initialMode.every);
  const [preview, setPreview] = useState<
    { key: string; runs: number[] | null; error: string | null } | null
  >(null);

  function pick(nextMode: ScheduleMode, nextEvery = every) {
    const steps = nextMode === "hours" ? HOUR_STEPS : MINUTE_STEPS;
    const safeEvery = steps.includes(nextEvery) ? nextEvery : (steps[2] ?? 1);
    setMode(nextMode);
    setEvery(safeEvery);
    setDraft(applyMode(draft, nextMode, safeEvery));
  }

  // The backend knows what a schedule really means: it validates the draft and
  // says when it would fire next.
  const key = JSON.stringify([
    draft.frequency, draft.timeOfDay, draft.daysOfWeek, draft.cron,
  ]);
  const previewable = isDraftValid(draft);
  useEffect(() => {
    if (!previewable) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      previewSchedule(draft)
        .then(({ data }) => {
          if (!cancelled) setPreview({ key, runs: data?.nextRuns ?? null, error: null });
        })
        .catch((e) => {
          if (cancelled) return;
          const message =
            (e as { response?: { data?: { errors?: string[] } } }).response?.data
              ?.errors?.[0] ?? getErrorMessage(e, "Invalid schedule.");
          setPreview({ key, runs: null, error: message });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `draft` is captured through `key`, which covers every field it sends
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, previewable]);

  const current = preview && preview.key === key ? preview : null;
  const problem = current?.error ?? null;
  useEffect(() => onProblem(problem), [problem, onProblem]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Frequency"
          value={mode}
          onChange={(e) => pick(e.target.value as ScheduleMode)}
          className={SELECT}
        >
          {(Object.keys(MODE_LABEL) as ScheduleMode[]).map((m) => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
        {(mode === "minutes" || mode === "hours") && (
          <>
            <span className="text-sm text-muted-foreground">every</span>
            <select
              aria-label="Interval"
              value={every}
              onChange={(e) => pick(mode, Number(e.target.value))}
              className={SELECT}
            >
              {(mode === "minutes" ? MINUTE_STEPS : HOUR_STEPS).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">
              {mode === "minutes" ? "minute(s)" : "hour(s)"}
            </span>
          </>
        )}
        {(mode === "daily" || mode === "weekly") && (
          <>
            <span className="text-sm text-muted-foreground">at</span>
            <Input
              aria-label="Time"
              type="time"
              value={draft.timeOfDay}
              onChange={(e) => setDraft({ ...draft, timeOfDay: e.target.value })}
              className="w-32"
            />
          </>
        )}
      </div>

      {mode === "weekly" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
          {DAY_LABELS.map((label, day) => {
            const active = draft.daysOfWeek.includes(day);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setDraft({ ...draft, daysOfWeek: toggleDay(draft.daysOfWeek, day) })
                }
                className={
                  "rounded-md border px-2 py-1 text-xs " +
                  (active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:bg-muted")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {mode === "custom" && (
        <div className="flex flex-col gap-1.5">
          <Input
            aria-label="Cron expression"
            value={draft.cron}
            onChange={(e) => setDraft({ ...draft, cron: e.target.value })}
            placeholder="*/5 * * * *"
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            minute hour day-of-month month day-of-week — e.g.{" "}
            <code>0 9 * * 1-5</code> is weekdays at 09:00.
          </p>
        </div>
      )}

      {problem ? (
        <p role="alert" className="text-xs text-destructive">{problem}</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {draft.frequency === "cron" && describeCron(draft.cron) && (
            <p className="text-sm">{describeCron(draft.cron)}</p>
          )}
          {current?.runs && (
            <p className="text-xs text-muted-foreground">
              Next: {current.runs.slice(0, 3).map(when).join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function InputStep({
  draft,
  setDraft,
}: {
  draft: ScheduleDraft;
  setDraft: (draft: ScheduleDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        This execution needs an input, and nobody can type it when it runs by
        itself. It will use this text every time.
      </p>
      <Textarea
        aria-label="Fixed input"
        value={draft.input}
        onChange={(e) => setDraft({ ...draft, input: e.target.value })}
        placeholder="Text this execution receives as its input on every scheduled run"
        className="min-h-[120px] max-h-[35vh]"
      />
    </div>
  );
}

function SettingsStep({
  background,
  onChange,
}: {
  background: BackgroundSettings | null;
  onChange: (patch: Partial<BackgroundSettings>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Schedules only run while HiveAI is open. Turn both on so it starts with
        your computer and keeps running when you close the window.
      </p>
      <label className="flex items-center justify-between gap-3 text-sm">
        Open HiveAI when I log in
        <Switch
          checked={background?.launchAtLogin ?? false}
          onCheckedChange={(launchAtLogin) => onChange({ launchAtLogin })}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        Keep running in the background when the window is closed
        <Switch
          checked={background?.runInBackground ?? false}
          onCheckedChange={(runInBackground) => onChange({ runInBackground })}
        />
      </label>
    </div>
  );
}

function AcceptStep({ draft }: { draft: ScheduleDraft }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="text-muted-foreground">Runs: </span>
        {describeSchedule({ ...draft })}
      </p>
      <p
        role="note"
        className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
      >
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <span>
          Scheduled runs are automatic: any plugin approval they request (file
          changes, shell commands…) is <strong>accepted without asking you</strong>,
          just like a normal run. Questions to the user get no answer.
        </span>
      </p>
    </div>
  );
}

export function ScheduleWizard({
  initial,
  creating,
  inputRequired,
  background,
  onChangeBackground,
  onSubmit,
  onCancel,
}: ScheduleWizardProps) {
  const [draft, setDraft] = useState(initial);
  const [whenProblem, setWhenProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [index, setIndex] = useState(0);

  // Decided once on entry: toggling a switch must not make the step vanish.
  const [steps] = useState<WizardStep[]>(() =>
    wizardSteps({
      creating,
      inputRequired,
      needsSettings:
        background !== null &&
        !(background.launchAtLogin && background.runInBackground),
    }),
  );

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const ok = canAdvance(step, draft, inputRequired, whenProblem);
  const finalLabel = creating ? "Accept and schedule" : "Save";

  async function submit() {
    setSaving(true);
    try {
      await onSubmit(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {steps.length > 1 && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Step {index + 1} of {steps.length}
          </p>
        )}
        <h3 className="text-base font-medium">{STEP_TITLE[step]}</h3>
      </div>

      {step === "when" && (
        <WhenStep draft={draft} setDraft={setDraft} onProblem={setWhenProblem} />
      )}
      {step === "input" && <InputStep draft={draft} setDraft={setDraft} />}
      {step === "settings" && (
        <SettingsStep background={background} onChange={onChangeBackground} />
      )}
      {step === "accept" && <AcceptStep draft={draft} />}

      <div className="flex justify-between gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={index === 0 ? onCancel : () => setIndex(index - 1)}
        >
          {index === 0 ? "Cancel" : "Back"}
        </Button>
        {isLast ? (
          <Button size="sm" disabled={saving || !ok} onClick={submit}>
            {finalLabel}
          </Button>
        ) : (
          <Button size="sm" disabled={!ok} onClick={() => setIndex(index + 1)}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
