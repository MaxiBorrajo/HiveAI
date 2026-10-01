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
          className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-emerald-400">{key}</span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
              {typeof value}
            </span>
          </div>
          <pre className="text-xs font-mono text-zinc-300 bg-black/40 p-2.5 rounded-lg border border-zinc-800/60 overflow-x-auto max-h-56 break-all whitespace-pre-wrap">
            {stringifyContent(value)}
          </pre>
        </div>
      ))}
    </div>
  );
}
