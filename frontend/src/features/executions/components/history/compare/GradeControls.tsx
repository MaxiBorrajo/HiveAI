import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage } from "@/lib/errors";
import { reportError } from "@/lib/toastManager";
import type { ModelChoice } from "@/features/models/lib/modelChoices";
import { getRubric, saveRubric } from "../../../api/rubric";
import { gradeRuns } from "../../../api/gradeRuns";
import type { Rubric, RunSummary } from "../../../types";
import { JudgeModelSelect } from "../JudgeModelSelect";

const DEFAULT_RUBRIC =
  "Did the run complete the task correctly and completely? Penalize mistakes, missing parts and invented information.";

export function GradeControls({
  executionId,
  runs,
  judge,
  onJudgeChange,
  onGraded,
}: {
  executionId: string;
  runs: RunSummary[];
  judge: ModelChoice | null;
  onJudgeChange: (choice: ModelChoice) => void;
  onGraded: () => void;
}) {
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [text, setText] = useState(DEFAULT_RUBRIC);
  const [customizing, setCustomizing] = useState(false);
  const [grading, setGrading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRubric(executionId)
      .then(({ data }) => {
        if (cancelled || !data?.rubric) return;
        setRubric(data.rubric);
        setText(data.rubric.rubric);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(getErrorMessage(e, "Could not load the rubric."));
      });
    return () => {
      cancelled = true;
    };
  }, [executionId]);

  const criteria = text.trim() || DEFAULT_RUBRIC;
  const dirty = criteria !== (rubric?.rubric ?? "");

  // Grades are stored per run, rubric and judge, so a run already judged with
  // this criterion is reused by every later comparison instead of re-judged.
  const pending = runs.filter(
    (run) =>
      dirty ||
      !run.grades.some(
        (g) =>
          g.status === "graded" &&
          g.rubric.id === rubric?.id &&
          g.judge.model === judge?.model &&
          g.judge.provider === judge?.provider,
      ),
  );
  const toGrade = pending.length > 0 ? pending : runs;

  const grade = async () => {
    if (!judge) return;
    setGrading(true);
    try {
      let current = rubric;
      if (!current || dirty) {
        const saved = await saveRubric(executionId, criteria);
        current = saved.data?.rubric ?? null;
        setRubric(current);
        setText(criteria);
      }
      if (!current) return;
      const { data } = await gradeRuns(
        executionId,
        toGrade.map((r) => r.historyId),
        judge,
        current.id,
      );
      const failed = data?.grades.filter((g) => g.status === "failed").length ?? 0;
      if (failed > 0) {
        reportError([`The judge could not grade ${failed} run(s); they stay unevaluated.`]);
      }
      onGraded();
    } catch (e) {
      reportError([getErrorMessage(e, "Could not grade the runs.")]);
    } finally {
      setGrading(false);
    }
  };

  const label = grading
    ? "Judging…"
    : pending.length === 0
      ? "Judge again"
      : pending.length === runs.length
        ? `Judge ${runs.length} runs`
        : `Judge ${pending.length} new run${pending.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={grading || !judge} onClick={() => void grade()}>
          {label}
        </Button>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Criterion:</span>{" "}
          {criteria} Each run gets its own score from 1 to 10
          {judge ? `, graded by ${judge.model}` : ""}. To compare runs or ask
          about something specific, use the question bar below.
        </p>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setCustomizing((o) => !o)}
        >
          <ChevronDownIcon
            className={`size-3 transition-transform ${customizing ? "" : "-rotate-90"}`}
          />
          Customize
        </button>
      </div>
      {customizing && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Judge model</span>
            <JudgeModelSelect value={judge} onChange={onJudgeChange} disabled={grading} />
          </div>
          {loadError && <p className="text-xs text-destructive">{loadError}</p>}
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-xs text-muted-foreground">
              Criterion
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => setText(DEFAULT_RUBRIC)}
              >
                Reset to default
              </button>
            </span>
            <Textarea
              value={text}
              rows={3}
              onChange={(e) => setText(e.target.value)}
              disabled={grading}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Changing the criterion saves a new version
            {rubric ? ` (current: v${rubric.version})` : ""}; scores from
            different versions are flagged as not comparable.
          </p>
        </div>
      )}
    </div>
  );
}
