import { useState } from "react";
import { Play, Loader2, Terminal, CircleCheckBig, SlidersHorizontal, Copy, Check, Pencil } from "lucide-react";
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
  onEdit: () => void;
}

const SEGMENT =
  "flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-900/90 hover:text-zinc-200 active:bg-zinc-800 transition-all select-none cursor-pointer";

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
  onEdit,
}: RunControlsBarProps) {
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const { copied: isCopied, copy: copyText } = useCopyFeedback();

  return (
    <div className="absolute top-6 right-6 z-20 pointer-events-auto flex flex-col items-end gap-2">
      <div className="inline-flex items-stretch rounded-xl bg-zinc-950/90 border border-zinc-800 shadow-2xl backdrop-blur-md overflow-hidden divide-x divide-zinc-800/80">
        <button
          type="button"
          onClick={onRun}
          disabled={isThinking || isRunning}
          className={cn(
            "group flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium transition-all select-none",
            isRunning
              ? "bg-amber-500/10 text-amber-300 cursor-wait"
              : "text-zinc-200 hover:bg-zinc-900/90 hover:text-white active:bg-zinc-800",
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
              <Play className="size-3.5 fill-emerald-400 text-emerald-400 transition-transform group-hover:scale-110" />
              <span className="font-medium">Run Execution</span>
            </>
          )}
        </button>

        {!hasRequiredInputs && !isRunning && (
          <button
            type="button"
            onClick={onOpenRunModal}
            disabled={isThinking}
            className="flex items-center justify-center px-2 py-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-all border-l border-zinc-800/80 cursor-pointer"
            title="Run with Custom Parameters..."
          >
            <SlidersHorizontal className="size-3.5" />
          </button>
        )}

        {hasResult && (
          <button
            type="button"
            onClick={onShowResult}
            className="group flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 active:bg-emerald-500/20 transition-all"
            title="View Execution Result & State"
          >
            <CircleCheckBig className="size-3.5 text-emerald-400 transition-transform group-hover:scale-110" />
            <span>Result</span>
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
              ? "bg-zinc-800/90 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-900/90 hover:text-zinc-200"
          )}
          title="Toggle Execution Logs"
        >
          <Terminal className="size-3.5" />
          <span>Logs</span>
          {logs.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-400">
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
                <Check className="size-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Copied!</span>
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
