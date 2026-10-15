import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatDuration } from "@/lib/formatUsage";
import type { ActivityEntry } from "../lib/generationActivity";

interface GenerationActivityFeedProps {
  entries: ActivityEntry[];
  isActive: boolean;
  onSelectNode: (nodeId: string) => void;
}

function currentLabel(entries: ActivityEntry[]): string {
  const last = entries[entries.length - 1];
  if (!last) return "Starting...";
  if (last.kind === "waiting") return last.text;
  if (last.kind === "configuring") return `${last.text}...`;
  if (last.kind === "planning") return last.text;
  return "Working...";
}

export function GenerationActivityFeed({
  entries,
  isActive,
  onSelectNode,
}: GenerationActivityFeedProps) {
  const [expanded, setExpanded] = useState(true);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive) setExpanded(true);
  }, [isActive]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);

  if (!isActive) return null;

  const configured = entries.filter((e) => e.kind === "configured").length;
  const total = entries.filter((e) => e.kind === "built").length;

  return (
    <div className="w-full rounded-xl border border-border bg-popover/95 p-2 text-xs shadow-sm backdrop-blur-md">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center gap-2 px-1 py-0.5 text-left"
      >
        <span
          className="min-w-0 flex-1 truncate animate-pulse text-muted-foreground"
        >
          {`${currentLabel(entries)}${total > 0 ? ` · ${configured}/${total} nodes configured` : ""}`}
        </span>
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 flex max-h-64 flex-col gap-1 overflow-y-auto px-1">
          {entries.map((entry) => {
            const running =
              isActive && entry.kind === "configuring" && !entry.durationMs;
            const clickable = !!entry.nodeId && entry.kind !== "removed";
            return (
              <div
                key={entry.id}
                className="flex items-start gap-2"
              >
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => entry.nodeId && onSelectNode(entry.nodeId)}
                  className={`min-w-0 flex-1 whitespace-pre-wrap wrap-break-word text-left ${
                    entry.kind === "error"
                      ? "text-destructive"
                      : entry.kind === "waiting"
                        ? "text-primary"
                        : entry.kind === "answered"
                          ? "text-foreground"
                          : "text-muted-foreground"
                  } ${running ? "animate-pulse" : ""} ${
                    clickable ? "hover:text-foreground" : ""
                  }`}
                >
                  {entry.text}
                </button>
                {entry.durationMs !== undefined && (
                  <span className="shrink-0 tabular-nums text-muted-foreground/70">
                    {formatDuration(entry.durationMs)}
                  </span>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
