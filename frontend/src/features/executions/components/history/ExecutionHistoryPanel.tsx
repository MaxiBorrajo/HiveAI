import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/formatUsage";
import { getErrorMessage } from "@/lib/errors";
import { getExecutionRuns } from "../../api/getExecutionRuns";
import { normalizeResult } from "../../lib/executionResult";
import type { RunSummary } from "../../types";
import { RunUsageBreakdown } from "./RunUsageBreakdown";

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: RunSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const result = normalizeResult(run.result);
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <li className="rounded-md border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/50"
      >
        <Chevron className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-baseline gap-2 text-sm">
            <span className="font-mono text-xs font-medium">
              #{run.iteration}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(run.createdAt).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {result.summary}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {run.usage
              ? `${run.usage.calls} call${run.usage.calls === 1 ? "" : "s"} · ${formatDuration(run.usage.latencyMs)}`
              : "No usage data"}
            {run.usage && run.usage.failedCalls > 0 && (
              <span className="text-destructive">
                {" "}
                · {run.usage.failedCalls} failed
              </span>
            )}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border p-5">
          <RunUsageBreakdown usage={run.usage} />
        </div>
      )}
    </li>
  );
}

export function ExecutionHistoryPanel({
  executionId,
  open,
  onOpenChange,
  refreshKey,
}: {
  executionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Changes when a run finishes, so an open panel reloads.
  refreshKey: unknown;
}) {
  // Tagged with the execution they belong to, so another execution never
  // shows the previous one's runs while its own are loading.
  const [loaded, setLoaded] = useState<{
    executionId: string;
    runs: RunSummary[];
  } | null>(null);
  const [failure, setFailure] = useState<{
    executionId: string;
    message: string;
  } | null>(null);
  const [expanded, setExpanded] = useState<{
    executionId: string;
    historyId: number;
  } | null>(null);

  const runs = loaded?.executionId === executionId ? loaded.runs : null;
  const error = failure?.executionId === executionId ? failure.message : null;
  const expandedId =
    expanded?.executionId === executionId ? expanded.historyId : null;

  useEffect(() => {
    if (!open || !executionId) return;
    let cancelled = false;
    getExecutionRuns(executionId)
      .then(({ data }) => {
        if (cancelled) return;
        setLoaded({ executionId, runs: data?.runs ?? [] });
        setFailure(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setFailure({
            executionId,
            message: getErrorMessage(e, "Could not load the runs."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, executionId, refreshKey]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-background/40 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-lg flex-col gap-4 border-l border-border bg-popover p-4 text-popover-foreground shadow-xl outline-none duration-150 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right">
          <div className="flex items-center justify-between gap-2">
            <div>
              <DialogPrimitive.Title className="font-heading text-base font-medium">
                Run history
              </DialogPrimitive.Title>
              <p className="text-xs text-muted-foreground">
                Consumption of each run. Local and cloud are shown separately.
              </p>
            </div>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="pr-2">
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : runs === null ? (
                <p className="text-xs text-muted-foreground">Loading runs…</p>
              ) : runs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This execution has not been run yet. Run it and its
                  consumption will show up here.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {runs.map((run) => (
                    <RunRow
                      key={run.historyId}
                      run={run}
                      expanded={expandedId === run.historyId}
                      onToggle={() =>
                        setExpanded(
                          !executionId || expandedId === run.historyId
                            ? null
                            : { executionId, historyId: run.historyId },
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          </ScrollArea>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
