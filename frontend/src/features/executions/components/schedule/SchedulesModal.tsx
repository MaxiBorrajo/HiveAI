import { useEffect, useState } from "react";
import { AlertTriangleIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { reportError } from "@/lib/toastManager";
import { getErrorMessage } from "@/lib/errors";
import {
  createSchedule,
  deleteSchedule,
  dismissScheduleRun,
  getBackgroundSettings,
  updateBackgroundSettings,
  updateSchedule,
} from "../../api/schedules";
import { useSchedules } from "../../hooks/useSchedules";
import { ScheduleWizard } from "./ScheduleWizard";
import {
  DEFAULT_DRAFT,
  RUN_STATUS_LABEL,
  describeSchedule,
  pendingMissed,
} from "../../lib/schedule";
import type {
  BackgroundSettings,
  Schedule,
  ScheduleDraft,
  ScheduleRun,
} from "../../types";

function draftOf(schedule: Schedule | null): ScheduleDraft {
  if (!schedule) return DEFAULT_DRAFT;
  return {
    frequency: schedule.frequency,
    timeOfDay: schedule.timeOfDay,
    daysOfWeek: schedule.daysOfWeek,
    cron: schedule.cron || DEFAULT_DRAFT.cron,
    input: schedule.input,
  };
}

const when = (ms: number) =>
  new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

interface SchedulesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executionId: string | null;
  /** Re-run a missed execution on purpose (never done automatically). */
  onRunNow: () => void;
  /** Lets the parent refresh its "missed" indicator after a change. */
  onChanged: () => void;
  /** Bumps when a scheduled run finishes, so the log stays current. */
  refreshKey?: number;
}

function RunLog({ runs }: { runs: ScheduleRun[] }) {
  if (runs.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-sm font-medium">Scheduled runs</h4>
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {runs.slice(0, 15).map((run) => (
          <li
            key={run.id}
            className="flex items-baseline justify-between gap-2 text-xs"
          >
            <span className="text-muted-foreground">{when(run.scheduledFor)}</span>
            <span
              className={
                run.status === "failed"
                  ? "text-destructive"
                  : run.status === "missed"
                    ? "text-amber-600 dark:text-amber-400"
                    : ""
              }
              title={run.error ?? undefined}
            >
              {RUN_STATUS_LABEL[run.status]}
              {run.status === "missed" && run.missedCount > 1
                ? ` (${run.missedCount})`
                : ""}
              {run.error ? ` · ${run.error}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SchedulesModal({
  open,
  onOpenChange,
  executionId,
  onRunNow,
  onChanged,
  refreshKey = 0,
}: SchedulesModalProps) {
  const { data, error, reload } = useSchedules(executionId, open, refreshKey);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [background, setBackground] = useState<BackgroundSettings | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getBackgroundSettings()
      .then(({ data }) => {
        if (!cancelled && data) setBackground(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    try {
      await action();
      await reload();
      onChanged();
      return true;
    } catch (e) {
      reportError([getErrorMessage(e, fallback)]);
      return false;
    }
  }

  async function changeBackground(patch: Partial<BackgroundSettings>) {
    try {
      const { data } = await updateBackgroundSettings(patch);
      if (data) setBackground(data);
    } catch (e) {
      reportError([getErrorMessage(e, "Could not change this setting.")]);
    }
  }

  const missed = data ? pendingMissed(data.runs) : [];
  const inputRequired = data?.inputRequired ?? false;
  const schedules = data?.schedules ?? [];
  const needsBackground =
    schedules.some((s) => s.enabled) &&
    background !== null &&
    !(background.launchAtLogin && background.runInBackground);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule</DialogTitle>
            {editing === null && (
              <DialogDescription>
                Run this execution on its own. HiveAI must be open (it can stay
                in the background) at the scheduled time.
              </DialogDescription>
            )}
          </DialogHeader>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {editing !== null && (
            <ScheduleWizard
              key={editing}
              creating={editing === "new"}
              initial={
                editing === "new"
                  ? DEFAULT_DRAFT
                  : draftOf(schedules.find((s) => s.id === editing) ?? null)
              }
              inputRequired={inputRequired}
              background={background}
              onChangeBackground={(patch) => void changeBackground(patch)}
              onCancel={() => setEditing(null)}
              onSubmit={async (draft) => {
                const ok = await run(
                  () =>
                    editing === "new"
                      ? createSchedule(executionId!, draft)
                      : updateSchedule(editing, draft),
                  "Could not save the schedule.",
                );
                if (ok) setEditing(null);
              }}
            />
          )}

          {editing === null && missed.length > 0 && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
            >
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                <p>
                  HiveAI was not running for{" "}
                  {missed.reduce((n, r) => n + r.missedCount, 0)} scheduled
                  run(s). They were <strong>not</strong> run automatically.
                </p>
              </div>
              <ul className="text-muted-foreground">
                {missed.map((run) => (
                  <li key={run.id}>Last one due {when(run.scheduledFor)}</li>
                ))}
              </ul>
              <div className="flex justify-end gap-1.5">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    run(
                      () => Promise.all(missed.map((r) => dismissScheduleRun(r.id))),
                      "Could not dismiss.",
                    )
                  }
                >
                  Dismiss
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={async () => {
                    const ok = await run(
                      () => Promise.all(missed.map((r) => dismissScheduleRun(r.id))),
                      "Could not dismiss.",
                    );
                    if (ok) {
                      onOpenChange(false);
                      onRunNow();
                    }
                  }}
                >
                  Run now
                </Button>
              </div>
            </div>
          )}

          {editing === null && (
          <section className="flex flex-col gap-2">
            {data === null && !error ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (
              <>
                {schedules.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No schedules yet.
                  </p>
                )}
                {schedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      className="flex items-center gap-3 rounded-md border border-border p-3"
                    >
                      <Switch
                        aria-label={schedule.enabled ? "Pause schedule" : "Resume schedule"}
                        checked={schedule.enabled}
                        onCheckedChange={(enabled) =>
                          void run(
                            () => updateSchedule(schedule.id, { enabled }),
                            "Could not change the schedule.",
                          )
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{describeSchedule(schedule)}</p>
                        {schedule.input && (
                          <p className="truncate text-xs text-muted-foreground" title={schedule.input}>
                            Input: {schedule.input}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {schedule.enabled
                            ? `Next run ${when(schedule.nextRunAt)}`
                            : "Paused"}
                        </p>
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Edit schedule"
                        onClick={() => setEditing(schedule.id)}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete schedule"
                        onClick={() => setDeleting(schedule)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                ))}

                {/* One schedule per execution: edit it instead of adding another. */}
                {schedules.length === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start"
                    disabled={!executionId}
                    onClick={() => setEditing("new")}
                  >
                    <PlusIcon />
                    Add schedule
                  </Button>
                )}
              </>
            )}
          </section>
          )}

          {editing === null && <RunLog runs={data?.runs ?? []} />}

          {editing === null && background && (
            <section className="flex flex-col gap-2 border-t border-border pt-3">
              {needsBackground && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Schedules only run while HiveAI is open. Turn both on so it
                  starts with your computer and keeps running when closed.
                </p>
              )}
              <label className="flex items-center justify-between gap-3 text-sm">
                Open HiveAI when I log in
                <Switch
                  checked={background.launchAtLogin}
                  onCheckedChange={(launchAtLogin) =>
                    void changeBackground({ launchAtLogin })
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Keep running in the background when the window is closed
                <Switch
                  checked={background.runInBackground}
                  onCheckedChange={(runInBackground) =>
                    void changeBackground({ runInBackground })
                  }
                />
              </label>
            </section>
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        entityName="schedule"
        itemName={deleting ? describeSchedule(deleting) : undefined}
        onConfirm={async () => {
          if (deleting) {
            await run(() => deleteSchedule(deleting.id), "Could not delete the schedule.");
          }
        }}
      />
    </>
  );
}
