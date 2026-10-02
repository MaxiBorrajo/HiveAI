import { Terminal } from "lucide-react";

interface ExecutionLogsDrawerProps {
  logs: string[];
  onClose: () => void;
}

export function ExecutionLogsDrawer({ logs, onClose }: ExecutionLogsDrawerProps) {
  return (
    <div className="w-80 bg-zinc-950/95 text-emerald-400 p-2.5 text-xs overflow-auto font-mono rounded-xl shadow-2xl border border-zinc-800/90 max-h-64 backdrop-blur-md animate-in fade-in-50 slide-in-from-top-2 duration-150">
      <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1.5 tracking-wider flex items-center justify-between border-b border-zinc-800/80 pb-1">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Terminal className="size-3" />
          <span>Console Logs</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-500 font-mono">{logs.length} lines</span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-xs px-1 hover:bg-zinc-800 rounded transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="space-y-0.5">
        {logs.map((l, i) => (
          <div key={i} className="leading-relaxed wrap-break-word font-mono">{l}</div>
        ))}
      </div>
    </div>
  );
}
