import { stringifyContent } from "@/lib/download";

export function StateVariablesPanel({
  variables,
}: {
  variables: [string, unknown][];
}) {
  return (
    <div className="p-4 space-y-3">
      {variables.map(([key, value]) => (
        <div
          key={key}
          className="rounded-xl border border-border/80 bg-muted/40 p-3.5 space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">{key}</span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/50">
              {typeof value}
            </span>
          </div>
          <pre className="text-xs font-mono text-muted-foreground bg-background/40 p-2.5 rounded-lg border border-border/60 overflow-x-auto max-h-56 break-all whitespace-pre-wrap">
            {stringifyContent(value)}
          </pre>
        </div>
      ))}
    </div>
  );
}
