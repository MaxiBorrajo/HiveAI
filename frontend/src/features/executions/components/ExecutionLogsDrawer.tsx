import { Terminal } from "lucide-react";

interface ExecutionLogsDrawerProps {
  logs: string[];
  onClose: () => void;
}

export function ExecutionLogsDrawer({ logs, onClose }: ExecutionLogsDrawerProps) {
  return (
    <div className="w-80 bg-card/95 text-emerald-600 dark:text-emerald-400 p-2.5 text-xs overflow-auto font-mono rounded-xl shadow-2xl border border-border/90 max-h-64 backdrop-blur-md animate-in fade-in-50 slide-in-from-top-2 duration-150">
      <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 tracking-wider flex items-center justify-between border-b border-border/80 pb-1">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Terminal className="size-3" />
          <span>Console Logs</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground font-mono">{logs.length} lines</span>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xs px-1 hover:bg-muted rounded transition-colors"
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
