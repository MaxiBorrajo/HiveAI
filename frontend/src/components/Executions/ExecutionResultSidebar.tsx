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
  Terminal,
  Table as TableIcon,
  ExternalLink,
  Image as ImageIcon,
  AlertTriangle,
  FileCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageMarkdown } from "@/components/Chat/MessageMarkdown";
import { cn } from "@/lib/utils";
import { useResizableSidebar } from "@/lib/useResizableSidebar";
import type {
  ExecutionResult,
  ExecutionFileArtifact,
  ExecutionResultType,
  ExecutionResultData,
} from "../../types/execution.ts";

export type { ExecutionResultData };

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
  const [copiedPath, setCopiedPath] = useState(false);
  const [activeTab, setActiveTab] = useState<"result" | "raw" | "state">("result");
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

  // Normalize data.result into structured ExecutionResult contract
  const rawResult = data.result;
  const isStructuredResult =
    rawResult &&
    typeof rawResult === "object" &&
    typeof rawResult.type === "string" &&
    "content" in rawResult;

  const resObj: ExecutionResult = isStructuredResult
    ? (rawResult as ExecutionResult)
    : {
        type:
          typeof rawResult === "boolean"
            ? "boolean"
            : typeof rawResult === "string" &&
              (rawResult.includes("#") || rawResult.includes("**") || rawResult.includes("```"))
            ? "markdown"
            : typeof rawResult === "object" && rawResult !== null
            ? Array.isArray(rawResult)
              ? "table"
              : "json"
            : "text",
        summary: "Resultado de la ejecución",
        content: rawResult,
      };

  // Filter out the primary result from state variables to avoid repetition
  const otherStateVariables = Object.entries(data.finalState || {}).filter(
    ([k]) => k !== "result" && k !== "messages" && k !== "feedback",
  );

  const handleCopy = () => {
    const textToCopy =
      typeof resObj.content === "string"
        ? resObj.content
        : JSON.stringify(resObj.content, null, 2);

    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  const handleDownload = () => {
    if (resObj.files && resObj.files.length > 0) {
      const primaryFile = resObj.files[0];
      handleDownloadFile(primaryFile, resObj.content);
      return;
    }

    const textToDownload =
      typeof resObj.content === "string"
        ? resObj.content
        : JSON.stringify(resObj.content, null, 2);

    const isJson = resObj.type === "json" || resObj.type === "table";
    const extension = isJson ? "json" : "md";
    const mime = isJson ? "application/json" : "text/markdown";

    const blob = new Blob([textToDownload], {
      type: `${mime};charset=utf-8`,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = (executionName || "result")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
    link.href = url;
    link.download = `${safeName}-${Date.now()}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadFile = (file: ExecutionFileArtifact, fileContent: any) => {
    const text =
      typeof fileContent === "string"
        ? fileContent
        : JSON.stringify(fileContent, null, 2);
    const blob = new Blob([text], {
      type: file.mimeType || "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getTypeTheme = (type: ExecutionResultType) => {
    switch (type) {
      case "file":
        return {
          label: "FILE DELIVERABLE",
          badgeBg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          icon: <FileText className="size-3.5 text-emerald-400" />,
        };
      case "markdown":
        return {
          label: "MARKDOWN REPORT",
          badgeBg: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
          icon: <FileText className="size-3.5 text-cyan-400" />,
        };
      case "table":
        return {
          label: "TABULAR DATA",
          badgeBg: "bg-sky-500/10 text-sky-400 border-sky-500/20",
          icon: <TableIcon className="size-3.5 text-sky-400" />,
        };
      case "json":
        return {
          label: "STRUCTURED JSON",
          badgeBg: "bg-blue-500/10 text-blue-400 border-blue-500/20",
          icon: <Code2 className="size-3.5 text-blue-400" />,
        };
      case "terminal":
        return {
          label: "SHELL OUTPUT",
          badgeBg: "bg-purple-500/10 text-purple-400 border-purple-500/20",
          icon: <Terminal className="size-3.5 text-purple-400" />,
        };
      case "boolean":
        return {
          label: "DECISION RESULT",
          badgeBg: "bg-amber-500/10 text-amber-400 border-amber-500/20",
          icon: <CheckCircle2 className="size-3.5 text-amber-400" />,
        };
      case "image":
        return {
          label: "GENERATED IMAGE",
          badgeBg: "bg-pink-500/10 text-pink-400 border-pink-500/20",
          icon: <ImageIcon className="size-3.5 text-pink-400" />,
        };
      case "url":
        return {
          label: "DESTINATION URL",
          badgeBg: "bg-teal-500/10 text-teal-400 border-teal-500/20",
          icon: <ExternalLink className="size-3.5 text-teal-400" />,
        };
      case "error":
        return {
          label: "EXECUTION ERROR",
          badgeBg: "bg-rose-500/10 text-rose-400 border-rose-500/20",
          icon: <AlertTriangle className="size-3.5 text-rose-400" />,
        };
      default:
        return {
          label: "OUTPUT",
          badgeBg: "bg-zinc-800 text-zinc-300 border-zinc-700",
          icon: <FileCode className="size-3.5 text-zinc-400" />,
        };
    }
  };

  const typeTheme = getTypeTheme(resObj.type);

  return (
    <div
      style={{ width: `${sidebarWidth}px`, maxWidth: "calc(100vw - 280px)" }}
      className={cn(
        "fixed inset-y-0 right-0 z-50 bg-zinc-950/95 border-l border-zinc-800 shadow-2xl backdrop-blur-xl flex flex-col animate-in slide-in-from-right duration-200",
        isResizing && "select-none duration-0",
      )}
    >
      {/* Drag handle */}
      <div
        onMouseDown={startResizing}
        className="absolute left-0 inset-y-0 w-1.5 -translate-x-1/2 cursor-ew-resize hover:bg-emerald-500/50 transition-colors z-50 group"
      >
        <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-1 h-8 rounded-full bg-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Top Header */}
      <div className="p-4 border-b border-zinc-800/80 bg-zinc-950/80 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <CheckCircle2 className="size-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-semibold text-sm text-zinc-100 truncate">
                {executionName || "Execution Result"}
              </h3>
              <span
                className={`text-[9.5px] font-mono font-medium px-2 py-0.5 rounded-full border ${typeTheme.badgeBg} flex items-center gap-1 shrink-0`}
              >
                {typeTheme.icon}
                {typeTheme.label}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
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
            onClick={handleCopy}
            title="Copy content"
            className="size-7 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-400" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            title="Download result"
            className="size-7 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80"
          >
            <Download className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMaximize}
            title={isMaximized ? "Restore size" : "Expand width"}
            className="size-7 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80"
          >
            {isMaximized ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>

          <div className="w-[1px] h-4 bg-zinc-800 mx-0.5" />

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="Close sidebar"
            className="size-7 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Segmented Tab Navigation */}
      <div className="px-4 py-2 border-b border-zinc-800/60 bg-zinc-950/40 flex items-center justify-between">
        <div className="inline-flex p-0.5 rounded-lg bg-zinc-900 border border-zinc-800/80 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("result")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all cursor-pointer",
              activeTab === "result"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            <FileText className="size-3" />
            <span>Preview</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("raw")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all cursor-pointer",
              activeTab === "raw"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            <Code2 className="size-3" />
            <span>Raw</span>
          </button>
          {otherStateVariables.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab("state")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all cursor-pointer",
                activeTab === "state"
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200",
              )}
            >
              <Database className="size-3" />
              <span>State</span>
              <span className="text-[10px] font-mono px-1 rounded bg-zinc-800 text-zinc-400">
                {otherStateVariables.length}
              </span>
            </button>
          )}
        </div>

        {resObj.summary && (
          <span className="text-[11px] text-zinc-400 font-sans truncate max-w-[220px]">
            {resObj.summary}
          </span>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "result" && (
          <div className="p-5 sm:p-6 space-y-4">
            {/* 1. File Artifact Card (Rendered if files exist) */}
            {resObj.files && resObj.files.length > 0 && (
              <div className="space-y-2">
                {resObj.files.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                        <FileText className="size-4.5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-xs text-zinc-100 truncate flex items-center gap-1.5">
                          {file.name}
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Saved to disk
                          </span>
                        </h4>
                        <p
                          className="text-[11px] text-zinc-400 font-mono truncate"
                          title={file.path}
                        >
                          {file.path}
                          {file.size
                            ? ` • ${(file.size / 1024).toFixed(1)} KB`
                            : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopyPath(file.path)}
                        className="h-7 text-xs bg-zinc-900 border-zinc-700/80 hover:bg-zinc-800 text-zinc-300"
                      >
                        {copiedPath ? (
                          <Check className="size-3 text-emerald-400 mr-1" />
                        ) : (
                          <Copy className="size-3 mr-1" />
                        )}
                        Copy Path
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadFile(file, resObj.content)}
                        className="h-7 text-xs bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-300"
                      >
                        <Download className="size-3 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 2. Primary Content Rendering based on Result Type */}
            {resObj.type === "file" || resObj.type === "markdown" ? (
              <div className="text-sm text-zinc-200 leading-relaxed max-w-none pt-1">
                <MessageMarkdown
                  content={
                    typeof resObj.content === "string"
                      ? resObj.content
                      : JSON.stringify(resObj.content, null, 2)
                  }
                />
              </div>
            ) : resObj.type === "boolean" ? (
              <div className="flex flex-col gap-1.5 p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40">
                <h4 className="text-sm font-semibold text-zinc-100">
                  Decision: {resObj.content ? "TRUE" : "FALSE"}
                </h4>
                <p className="text-xs text-zinc-400">{resObj.summary}</p>
              </div>
            ) : resObj.type === "table" &&
              Array.isArray(resObj.content) &&
              resObj.content.length > 0 &&
              typeof resObj.content[0] === "object" ? (
              <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/60 shadow-lg">
                <div className="overflow-x-auto max-h-[460px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-zinc-900/90 text-zinc-300 sticky top-0 border-b border-zinc-800 font-mono text-[11px]">
                      <tr>
                        {Object.keys(resObj.content[0]).map((header) => (
                          <th key={header} className="p-2.5 font-semibold">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-mono text-zinc-300">
                      {resObj.content.map((row: any, i: number) => (
                        <tr
                          key={i}
                          className="hover:bg-zinc-900/50 transition-colors"
                        >
                          {Object.values(row).map((val: any, j: number) => (
                            <td key={j} className="p-2.5 whitespace-nowrap">
                              {typeof val === "object"
                                ? JSON.stringify(val)
                                : String(val ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : resObj.type === "terminal" ? (
              <div className="rounded-xl border border-zinc-800 bg-black/90 overflow-hidden shadow-2xl">
                <div className="px-3 py-2 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-rose-500/80" />
                    <span className="size-2.5 rounded-full bg-amber-500/80" />
                    <span className="size-2.5 rounded-full bg-emerald-500/80" />
                    <span className="text-[10px] font-mono text-zinc-400 ml-2">
                      {resObj.metadata?.command || "bash session"}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400">
                    stdout
                  </span>
                </div>
                <pre className="p-4 text-xs font-mono text-emerald-400/90 whitespace-pre-wrap break-all overflow-x-auto leading-relaxed max-h-[460px]">
                  {typeof resObj.content === "string"
                    ? resObj.content
                    : JSON.stringify(resObj.content, null, 2)}
                </pre>
              </div>
            ) : resObj.type === "json" ? (
              <pre className="text-xs font-mono text-zinc-300 bg-zinc-900/40 p-4 rounded-xl overflow-x-auto whitespace-pre-wrap break-all border border-zinc-800/80">
                {JSON.stringify(resObj.content, null, 2)}
              </pre>
            ) : resObj.type === "image" ? (
              <div className="p-2 rounded-xl border border-zinc-800 bg-zinc-900/40 flex justify-center">
                <img
                  src={String(resObj.content)}
                  alt="Execution Output"
                  className="rounded-lg max-h-[500px] object-contain shadow-md"
                />
              </div>
            ) : resObj.type === "url" ? (
              <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 space-y-2">
                <h4 className="text-xs font-semibold text-zinc-200">
                  {resObj.summary}
                </h4>
                <a
                  href={String(resObj.content)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-mono text-emerald-400 hover:underline flex items-center gap-1.5 break-all"
                >
                  <ExternalLink className="size-3.5 shrink-0" />
                  {String(resObj.content)}
                </a>
              </div>
            ) : resObj.type === "error" ? (
              <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-950/20 text-rose-300 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-xs">
                  <AlertTriangle className="size-4 text-rose-400 shrink-0" />
                  <span>{resObj.summary}</span>
                </div>
                <pre className="text-xs font-mono bg-black/40 p-2.5 rounded-lg border border-rose-900/50 overflow-x-auto whitespace-pre-wrap break-all text-rose-200">
                  {typeof resObj.content === "string"
                    ? resObj.content
                    : JSON.stringify(resObj.content, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="text-sm text-zinc-200 leading-relaxed font-sans p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40">
                {String(resObj.content ?? "Execution completed with no return value.")}
              </div>
            )}
          </div>
        )}

        {activeTab === "raw" && (
          <div className="p-4">
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 font-mono text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed select-text">
              {typeof rawResult === "string"
                ? rawResult
                : JSON.stringify(rawResult, null, 2)}
            </div>
          </div>
        )}

        {activeTab === "state" && (
          <div className="p-4 space-y-3">
            {otherStateVariables.map(([key, value]) => {
              const valStr =
                typeof value === "string"
                  ? value
                  : JSON.stringify(value, null, 2);
              return (
                <div
                  key={key}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-emerald-400">
                      {key}
                    </span>
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                      {typeof value}
                    </span>
                  </div>
                  <pre className="text-xs font-mono text-zinc-300 bg-black/40 p-2.5 rounded-lg border border-zinc-800/60 overflow-x-auto max-h-56 break-all whitespace-pre-wrap">
                    {valStr}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3.5 border-t border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between gap-2">
        <div className="text-[11px] text-zinc-500 font-mono">
          Type: <span className="text-zinc-400">{resObj.type}</span>
        </div>
        <div className="flex items-center gap-2">
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
    </div>
  );
}

