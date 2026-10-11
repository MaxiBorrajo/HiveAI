import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GitCompareIcon,
  XIcon,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useSlidePresence } from "@/hooks/useSlidePresence";
import { formatDuration } from "@/lib/formatUsage";
import { getErrorMessage } from "@/lib/errors";
import { getExecutionRuns } from "../../api/getExecutionRuns";
import { normalizeResult } from "../../lib/executionResult";
import type { RunSummary } from "../../types";
import { RunComparisonModal } from "./RunComparisonModal";
import { RunUsageBreakdown } from "./RunUsageBreakdown";

const MAX_COMPARED = 2;

function RunRow({
  run,
  expanded,
  onToggle,
  selecting,
  selected,
  selectDisabled,
  onSelect,
}: {
  run: RunSummary;
  expanded: boolean;
  onToggle: () => void;
  // The checkbox only exists while the user is choosing runs to compare.
  selecting: boolean;
  selected: boolean;
  // Two runs are already picked and this is not one of them.
  selectDisabled: boolean;
  onSelect: () => void;
}) {
  const result = normalizeResult(run.result);
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <li className="flex items-start rounded-md border border-border">
      {selecting && (
        <label className="flex cursor-pointer pt-4 pl-4">
          <input
            type="checkbox"
            checked={selected}
            disabled={selectDisabled}
            onChange={onSelect}
            aria-label={`Select run #${run.iteration} to compare`}
            className="size-3.5 accent-foreground disabled:cursor-not-allowed"
          />
        </label>
      )}
      <div className="min-w-0 flex-1">
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
      </div>
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

  const [selected, setSelected] = useState<{
    executionId: string;
    historyIds: number[];
  } | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);

  const { mounted, shown } = useSlidePresence(open);

  const runs = loaded?.executionId === executionId ? loaded.runs : null;
  const selectedIds =
    selected?.executionId === executionId ? selected.historyIds : [];
  // Older run first, so "left" and "right" read in the order they happened.
  const compared =
    runs && selectedIds.length === MAX_COMPARED
      ? (runs
          .filter((run) => selectedIds.includes(run.historyId))
          .sort((a, b) => a.iteration - b.iteration) as [
          RunSummary,
          RunSummary,
        ])
      : null;
  const canCompare = compared !== null && compared.length === MAX_COMPARED;

  const toggleSelected = (historyId: number) => {
    if (!executionId) return;
    setSelected({
      executionId,
      historyIds: selectedIds.includes(historyId)
        ? selectedIds.filter((id) => id !== historyId)
        : selectedIds.length < MAX_COMPARED
          ? [...selectedIds, historyId]
          : selectedIds,
    });
  };
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
    <>
    <DialogPrimitive.Root open={mounted} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-background/40" />
        <DialogPrimitive.Popup
          // `right` is animated instead of a transform: the desktop webview
          // flickers on composited animations of big layers.
          style={{ right: shown ? 0 : "-32rem" }}
          className="fixed top-0 z-50 flex h-screen w-full max-w-lg flex-col gap-4 border-l border-border bg-popover p-4 text-popover-foreground shadow-xl outline-none transition-[right] duration-200 ease-out"
        >
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

          {runs && runs.length >= MAX_COMPARED && (
            <div className="flex items-center justify-between gap-2">
              {isSelecting ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {selectedIds.length === 0
                      ? "Select two runs to compare them."
                      : `${selectedIds.length} of ${MAX_COMPARED} selected.`}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setIsSelecting(false);
                        setSelected(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canCompare}
                      onClick={() => setIsComparing(true)}
                    >
                      <GitCompareIcon />
                      Compare
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsSelecting(true)}
                >
                  <GitCompareIcon />
                  Compare runs
                </Button>
              )}
            </div>
          )}

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
                      selecting={isSelecting}
                      selected={selectedIds.includes(run.historyId)}
                      selectDisabled={
                        selectedIds.length >= MAX_COMPARED &&
                        !selectedIds.includes(run.historyId)
                      }
                      onSelect={() => toggleSelected(run.historyId)}
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
    <RunComparisonModal
      runs={compared}
      open={isComparing && canCompare}
      onOpenChange={setIsComparing}
    />
    </>
  );
}
