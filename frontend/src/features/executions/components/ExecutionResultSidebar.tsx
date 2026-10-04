import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  Check,
  X,
  Play,
  Download,
  Maximize2,
  Minimize2,
  FileText,
  Code2,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadBlob, stringifyContent } from "@/lib/download";
import { normalizeResult } from "@/features/executions/lib/executionResult";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import type {
  ExecutionFileArtifact,
  ExecutionResultData,
} from "../types.ts";
import { FileArtifactCard } from "./result/FileArtifactCard";
import { ResultRenderer } from "./result/ResultRenderer";
import { SegmentedTabs, type SegmentedTab } from "./result/SegmentedTabs";
import { StateVariablesPanel } from "./result/StateVariablesPanel";
import { getResultTheme } from "./result/resultTheme";

type Tab = "result" | "raw" | "state";

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
  const { copied, copy } = useCopyFeedback();
  const [activeTab, setActiveTab] = useState<Tab>("result");
  const {
    width: sidebarWidth,
    isResizing,
    isMaximized,
    startResizing,
    toggleMaximize,
  } = useResizableSidebar({
    storageKey: "hiveai_result_sidebar_width",
    minWidth: 380,
    defaultWidth: 540,
    reservedViewportWidth: 300,
  });

  if (!isOpen || !data) return null;

  const resObj = normalizeResult(data.result);
  const typeTheme = getResultTheme(resObj.type);

  const otherStateVariables = Object.entries(data.finalState || {}).filter(
    ([k]) => k !== "result" && k !== "messages" && k !== "feedback",
  );

  const downloadFile = (file: ExecutionFileArtifact) =>
    downloadBlob(
      file.name,
      stringifyContent(resObj.content),
      file.mimeType || "text/plain;charset=utf-8",
    );

  const handleDownload = () => {
    if (resObj.files && resObj.files.length > 0) {
      downloadFile(resObj.files[0]);
      return;
    }

    const isJson = resObj.type === "json" || resObj.type === "table";
    const safeName = (executionName || "result")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
    downloadBlob(
      `${safeName}-${Date.now()}.${isJson ? "json" : "md"}`,
      stringifyContent(resObj.content),
      `${isJson ? "application/json" : "text/markdown"};charset=utf-8`,
    );
  };

  const tabs: SegmentedTab<Tab>[] = [
    { id: "result", label: "Preview", icon: <FileText className="size-3" /> },
    { id: "raw", label: "Raw", icon: <Code2 className="size-3" /> },
  ];
  if (otherStateVariables.length > 0) {
    tabs.push({
      id: "state",
      label: "State",
      icon: <Database className="size-3" />,
      badge: otherStateVariables.length,
    });
  }

  return (
    <div
      style={{ width: `${sidebarWidth}px`, maxWidth: "calc(100vw - 280px)" }}
      className={cn(
        "fixed inset-y-0 right-0 z-50 bg-card/95 border-l border-border shadow-2xl backdrop-blur-xl flex flex-col animate-in slide-in-from-right duration-200",
        isResizing && "select-none duration-0",
      )}
    >
      {/* Drag handle */}
      <div
        onMouseDown={startResizing}
        className="absolute left-0 inset-y-0 w-1.5 -translate-x-1/2 cursor-ew-resize hover:bg-emerald-500/50 transition-colors z-50 group"
      >
        <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-1 h-8 rounded-full bg-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Top Header */}
      <div className="p-4 border-b border-border/80 bg-card/80 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-semibold text-sm text-foreground truncate">
                {executionName || "Execution Result"}
              </h3>
              <span
                className={`text-[9.5px] font-mono font-medium px-2 py-0.5 rounded-full border ${typeTheme.badgeBg} flex items-center gap-1 shrink-0`}
              >
                {typeTheme.icon}
                {typeTheme.label}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                #{data.iteration || 1}
              </span>
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => copy(stringifyContent(resObj.content))}
            title="Copy content"
            className="size-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            title="Download result"
            className="size-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80"
          >
            <Download className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMaximize}
            title={isMaximized ? "Restore size" : "Expand width"}
            className="size-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80"
          >
            {isMaximized ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>

          <div className="w-[1px] h-4 bg-border mx-0.5" />

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="Close sidebar"
            className="size-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-border/60 bg-card/40 flex items-center justify-between">
        <SegmentedTabs<Tab> tabs={tabs} active={activeTab} onChange={setActiveTab} />
        {resObj.summary && (
          <span className="text-[11px] text-muted-foreground font-sans truncate max-w-[220px]">
            {resObj.summary}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "result" && (
          <div className="p-5 sm:p-6 space-y-4">
            {resObj.files && resObj.files.length > 0 && (
              <div className="space-y-2">
                {resObj.files.map((file, idx) => (
                  <FileArtifactCard
                    key={idx}
                    file={file}
                    onDownload={() => downloadFile(file)}
                  />
                ))}
              </div>
            )}
            <ResultRenderer result={resObj} />
          </div>
        )}

        {activeTab === "raw" && (
          <div className="p-4">
            <div className="rounded-xl border border-border/80 bg-muted/30 p-4 font-mono text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all leading-relaxed select-text">
              {stringifyContent(data.result)}
            </div>
          </div>
        )}

        {activeTab === "state" && (
          <StateVariablesPanel variables={otherStateVariables} />
        )}
      </div>

      {/* Footer */}
      <div className="p-3.5 border-t border-border/80 bg-muted/50 flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground font-mono">
          Type: <span className="text-muted-foreground">{resObj.type}</span>
        </div>
        <div className="flex items-center gap-2">
          {onRunAgain && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRunAgain}
              className="text-xs gap-1.5 border-border bg-muted/60 hover:bg-muted text-foreground"
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
    </div>
  );
}

