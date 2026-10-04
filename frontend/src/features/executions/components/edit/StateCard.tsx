import { X } from "lucide-react";
import type { LangGraphAbstraction } from "../../types";
import { BUILTIN_STATE_KEYS } from "../../lib/graphOps";

interface StateCardProps {
  graph: LangGraphAbstraction;
  onClose: () => void;
}

export function StateCard({ graph, onClose }: StateCardProps) {
  const entries = Object.entries(graph.stateSchema ?? {});
  const writerOf = (key: string) =>
    graph.nodes.find((n) => n.config?.outputKey === key)?.name;

  return (
    <div className="pointer-events-auto absolute right-66 top-20 z-20 flex max-h-[calc(100vh-14rem)] w-80 flex-col gap-2 overflow-auto rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">State</h3>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Variables nodes can read with {"${name}"} or in their Inputs.
      </p>
      <div className="flex flex-col gap-2">
        {entries.map(([key, def]) => {
          const writer = writerOf(key);
          const builtin = BUILTIN_STATE_KEYS.includes(key);
          return (
            <div key={key} className="rounded-lg border border-border bg-muted/50 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-foreground">{key}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                  {def.type}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {builtin ? "Provided when the execution starts" : writer ? `Written by ${writer}` : "No node writes this variable"}
              </p>
              {def.description && (
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{def.description}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
