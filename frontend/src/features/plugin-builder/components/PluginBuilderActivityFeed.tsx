import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ActivityEntry } from "../lib/pluginBuilderActivity";

interface PluginBuilderActivityFeedProps {
  entries: ActivityEntry[];
  isActive: boolean;
}

function currentLabel(entries: ActivityEntry[]): string {
  const last = entries[entries.length - 1];
  if (!last) return "Starting...";
  return last.text;
}

export function PluginBuilderActivityFeed({
  entries,
  isActive,
}: PluginBuilderActivityFeedProps) {
  const [expanded, setExpanded] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive) setExpanded(true);
  }, [isActive]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);

  if (!isActive) return null;

  return (
    <div className="w-full rounded-xl border border-border bg-popover/95 p-2 text-xs shadow-sm backdrop-blur-md">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center gap-2 px-1 py-0.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate animate-pulse text-muted-foreground">
          {currentLabel(entries)}
        </span>
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 flex max-h-64 flex-col gap-1 overflow-y-auto px-1">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2">
              <span
                className={`min-w-0 flex-1 whitespace-pre-wrap wrap-break-word text-left ${
                  entry.kind === "error"
                    ? "text-destructive"
                    : entry.kind === "done"
                      ? "text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {entry.text}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
