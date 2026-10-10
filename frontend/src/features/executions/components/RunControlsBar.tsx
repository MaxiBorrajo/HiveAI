import { useState } from "react";
import { Play, Loader2, Terminal, CircleCheckBig, SlidersHorizontal, Copy, Check, Pencil, History } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import type { LangGraphAbstraction } from "../types";
import { ExecutionLogsDrawer } from "./ExecutionLogsDrawer";

interface RunControlsBarProps {
  graph: LangGraphAbstraction | null;
  logs: string[];
  hasResult: boolean;
  isThinking: boolean;
  isRunning: boolean;
  hasRequiredInputs: boolean;
  onRun: () => void;
  onOpenRunModal: () => void;
  onShowResult: () => void;
  onShowHistory: () => void;
  onEdit: () => void;
}

const SEGMENT =
  "flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/90 hover:text-foreground active:bg-muted transition-all select-none cursor-pointer";

export function RunControlsBar({
  graph,
  logs,
  hasResult,
  isThinking,
  isRunning,
  hasRequiredInputs,
  onRun,
  onOpenRunModal,
  onShowResult,
  onShowHistory,
  onEdit,
}: RunControlsBarProps) {
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const { copied: isCopied, copy: copyText } = useCopyFeedback();

  return (
    <div className="absolute top-6 right-6 z-20 pointer-events-auto flex flex-col items-end gap-2">
      <div className="inline-flex items-stretch rounded-xl bg-card/90 border border-border shadow-2xl backdrop-blur-md overflow-hidden divide-x divide-border/80">
        <button
          type="button"
          onClick={onRun}
          disabled={isThinking || isRunning}
          className={cn(
            "group flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium transition-all select-none",
            isRunning
              ? "bg-amber-500/10 text-amber-300 cursor-wait"
              : "text-foreground hover:bg-muted/90 hover:text-foreground active:bg-muted",
            (isThinking || isRunning) && !isRunning && "opacity-50 cursor-not-allowed"
          )}
          title={hasRequiredInputs ? "Configure & Run Execution" : "Run Execution"}
        >
          {isRunning ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-amber-400" />
              <span>Running...</span>
            </>
          ) : (
            <>
              <Play className="size-3.5 fill-emerald-600 dark:fill-emerald-400 text-emerald-600 dark:text-emerald-400 transition-transform group-hover:scale-110" />
              <span className="font-medium">Run Execution</span>
            </>
          )}
        </button>

        {!hasRequiredInputs && !isRunning && (
          <button
            type="button"
            onClick={onOpenRunModal}
            disabled={isThinking}
            className="flex items-center justify-center px-2 py-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all border-l border-border/80 cursor-pointer"
            title="Run with Custom Parameters..."
          >
            <SlidersHorizontal className="size-3.5" />
          </button>
        )}

        {hasResult && (
          <button
            type="button"
            onClick={onShowResult}
            className="group flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 active:bg-emerald-500/20 transition-all"
            title="View Execution Result & State"
          >
            <CircleCheckBig className="size-3.5 text-emerald-600 dark:text-emerald-400 transition-transform group-hover:scale-110" />
            <span>Result</span>
          </button>
        )}

        {graph && (
          <button
            type="button"
            onClick={onShowHistory}
            className={SEGMENT}
            title="Past runs and what each one consumed"
          >
            <History className="size-3.5" />
            <span>History</span>
          </button>
        )}

        {graph && (
          <button
            type="button"
            onClick={onEdit}
            disabled={isThinking || isRunning}
            className={cn(SEGMENT, "disabled:cursor-not-allowed disabled:opacity-50")}
            title="Edit this execution's graph by hand"
          >
            <Pencil className="size-3.5" />
            <span>Edit</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setIsLogsOpen(!isLogsOpen)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all select-none cursor-pointer",
            isLogsOpen
              ? "bg-muted/90 text-foreground"
              : "text-muted-foreground hover:bg-muted/90 hover:text-foreground"
          )}
          title="Toggle Execution Logs"
        >
          <Terminal className="size-3.5" />
          <span>Logs</span>
          {logs.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground">
              {logs.length}
            </span>
          )}
        </button>

        {graph && (
          <button
            type="button"
            onClick={() => copyText(JSON.stringify(graph, null, 2))}
            className={SEGMENT}
            title="Copy full Graph JSON to clipboard"
          >
            {isCopied ? (
              <>
                <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy JSON</span>
              </>
            )}
          </button>
        )}
      </div>

      {isLogsOpen && logs.length > 0 && (
        <ExecutionLogsDrawer logs={logs} onClose={() => setIsLogsOpen(false)} />
      )}
    </div>
  );
}
