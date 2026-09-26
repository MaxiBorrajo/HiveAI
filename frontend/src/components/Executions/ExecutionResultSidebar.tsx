import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Database,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageMarkdown } from "@/components/Chat/MessageMarkdown";

export interface ExecutionResultData {
  result: any;
  finalState?: Record<string, any>;
  iteration?: number;
  historyId?: number;
  createdAt?: number;
}

interface ExecutionResultSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  data: ExecutionResultData | null;
  onRunAgain?: () => void;
  executionName?: string;
}

export function ExecutionResultSidebar({
  isOpen,
  onClose,
  data,
  onRunAgain,
  executionName,
}: ExecutionResultSidebarProps) {
  const [copied, setCopied] = useState(false);
  const [isStateOpen, setIsStateOpen] = useState(false);

  if (!isOpen || !data) return null;

  const handleCopy = () => {
    const textToCopy =
      typeof data.result === "string"
        ? data.result
        : JSON.stringify(data.result, null, 2);

    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rawResult = data.result;
  const isStringResult = typeof rawResult === "string";
  const isBooleanResult = typeof rawResult === "boolean";
  const isObjectResult = typeof rawResult === "object" && rawResult !== null;

  // Filter out the primary result from state variables to avoid repetition
  const otherStateVariables = Object.entries(data.finalState || {}).filter(
    ([k]) => k !== "result" && k !== "messages" && k !== "feedback",
  );

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-zinc-950/95 border-l border-zinc-800 shadow-2xl backdrop-blur-xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/40">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">
                Execution Result
              </h2>
              {data.iteration !== undefined && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Iter #{data.iteration}
                </span>
              )}
            </div>
            {executionName && (
              <p className="text-[11px] text-zinc-400 truncate max-w-[280px]">
                {executionName}
              </p>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="size-7 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Deliverable Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5 uppercase tracking-wider">
              <Sparkles className="size-3.5 text-amber-400" />
              Final Deliverable
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="h-7 text-xs gap-1 border-zinc-750 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-300"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  <span>Copy</span>
                </>
              )}
            </Button>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4 shadow-sm">
            {isStringResult ? (
              <div className="text-sm text-zinc-200 leading-relaxed max-w-none">
                <MessageMarkdown content={rawResult} />
              </div>
            ) : isBooleanResult ? (
              <div className="flex items-center gap-3 py-2">
                <div
                  className={`size-10 rounded-full flex items-center justify-center font-bold text-lg ${
                    rawResult
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-red-500/20 text-red-400 border border-red-500/30"
                  }`}
                >
                  {rawResult ? "✓" : "✕"}
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">
                    Decision: {rawResult ? "TRUE" : "FALSE"}
                  </h4>
                  <p className="text-xs text-zinc-400">
                    Condition validated successfully.
                  </p>
                </div>
              </div>
            ) : isObjectResult ? (
              <pre className="text-xs font-mono text-zinc-300 bg-black/40 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all border border-zinc-800/60">
                {JSON.stringify(rawResult, null, 2)}
              </pre>
            ) : (
              <div className="text-sm text-zinc-300 font-mono">
                {String(rawResult ?? "Execution completed with no return value.")}
              </div>
            )}
          </div>
        </div>

        {/* State Memory Variables Section */}
        {otherStateVariables.length > 0 && (
          <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 overflow-hidden">
            <button
              onClick={() => setIsStateOpen(!isStateOpen)}
              className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-zinc-800/30 transition-colors"
            >
              <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Database className="size-3.5 text-zinc-400" />
                Memory State Variables ({otherStateVariables.length})
              </span>
              {isStateOpen ? (
                <ChevronDown className="size-3.5 text-zinc-400" />
              ) : (
                <ChevronRight className="size-3.5 text-zinc-400" />
              )}
            </button>

            {isStateOpen && (
              <div className="p-3 pt-1 border-t border-zinc-800/50 space-y-2">
                {otherStateVariables.map(([key, value]) => {
                  const valStr =
                    typeof value === "string"
                      ? value
                      : JSON.stringify(value, null, 2);
                  return (
                    <div
                      key={key}
                      className="bg-black/30 rounded-lg p-2.5 border border-zinc-800/40 text-xs"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-semibold text-amber-300">
                          {key}
                        </span>
                        <span className="text-[10px] text-zinc-500 uppercase font-mono">
                          {typeof value}
                        </span>
                      </div>
                      <p className="text-zinc-400 font-mono text-[11px] max-h-28 overflow-y-auto break-all whitespace-pre-wrap">
                        {valStr}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3.5 border-t border-zinc-800/80 bg-zinc-900/50 flex items-center justify-end gap-2">
        {onRunAgain && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRunAgain}
            className="text-xs gap-1.5 border-zinc-700 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-200"
          >
            <Play className="size-3" />
            Run Again
          </Button>
        )}
        <Button
          variant="default"
          size="sm"
          onClick={onClose}
          className="text-xs px-4"
        >
          Close
        </Button>
      </div>
    </div>
  );
}
