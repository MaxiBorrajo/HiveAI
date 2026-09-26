import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  Bot,
  Brain,
  Globe,
  FileText,
  FileCode,
  Terminal,
  Clock,
  Wrench,
  PlayCircle,
  Flag,
  Sparkles,
  Puzzle,
  Cpu,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { NodeType } from "@/types/execution";

export interface StandardNodeData {
  name: string;
  type: NodeType;
  config?: Record<string, any>;
  isActive?: boolean;
  isUpdating?: boolean;
  isExecuting?: boolean;
  isSelected?: boolean;
  activeTool?: string | null;
}

function getToolIcon(toolName: string) {
  const lower = toolName.toLowerCase();
  if (lower.includes("search") && lower.includes("web")) {
    return <Globe className="size-3.5 text-cyan-400 shrink-0" />;
  }
  if (lower.includes("read") && lower.includes("web")) {
    return <FileText className="size-3.5 text-emerald-400 shrink-0" />;
  }
  if (lower.includes("file") || lower.includes("folder")) {
    return <FileCode className="size-3.5 text-amber-400 shrink-0" />;
  }
  if (lower.includes("shell") || lower.includes("bash") || lower.includes("terminal")) {
    return <Terminal className="size-3.5 text-purple-400 shrink-0" />;
  }
  if (lower.includes("time") || lower.includes("date") || lower.includes("clock")) {
    return <Clock className="size-3.5 text-orange-400 shrink-0" />;
  }
  return <Wrench className="size-3.5 text-zinc-400 shrink-0" />;
}

export function StandardNode({
  data,
  selected,
}: {
  id: string;
  data: StandardNodeData;
  selected?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isSelected = selected || data.isSelected;
  const isUpdating = data.isUpdating;
  const isExecuting = data.isExecuting;
  const plugins: string[] = Array.isArray(data.config?.plugins)
    ? data.config.plugins
    : [];
  const hasTools = data.type === "llm" && plugins.length > 0;

  // Auto-expand if the node is actively executing or explicitly selected
  const showTools = isExpanded || isExecuting || isSelected;

  // Outer border & glow
  let borderColor = "border-zinc-800";
  let boxShadow = "0 8px 24px -4px rgba(0,0,0,0.5)";

  if (isUpdating) {
    borderColor = "border-amber-500";
    boxShadow = "0 0 24px rgba(245, 158, 11, 0.4)";
  } else if (isExecuting) {
    borderColor = "border-emerald-500";
    boxShadow = "0 0 28px rgba(16, 185, 129, 0.55)";
  } else if (isSelected) {
    borderColor = "border-primary";
    boxShadow = "0 0 16px rgba(var(--primary-rgb, 59, 130, 246), 0.4)";
  }

  // Header styling per type
  const getHeaderTheme = () => {
    switch (data.type) {
      case "start":
        return {
          bg: "bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400",
          icon: <PlayCircle className="size-3.5" />,
          label: "START NODE",
        };
      case "end":
        return {
          bg: "bg-rose-500/10 border-b border-rose-500/20 text-rose-400",
          icon: <Flag className="size-3.5" />,
          label: "TERMINAL END",
        };
      case "plugin":
        return {
          bg: "bg-blue-500/10 border-b border-blue-500/20 text-blue-400",
          icon: <Puzzle className="size-3.5" />,
          label: `PLUGIN: ${String(data.config?.pluginId || "TOOL").toUpperCase()}`,
        };
      case "llm":
        return hasTools
          ? {
              bg: "bg-amber-500/15 border-b border-amber-500/25 text-amber-300",
              icon: <Bot className="size-3.5" />,
              label: "AUTONOMOUS AGENT",
            }
          : {
              bg: "bg-purple-500/10 border-b border-purple-500/20 text-purple-400",
              icon: <Brain className="size-3.5" />,
              label: "LLM REASONER",
            };
      default:
        return {
          bg: "bg-zinc-800/40 border-b border-zinc-700/50 text-zinc-300",
          icon: <Sparkles className="size-3.5" />,
          label: "PROCESS",
        };
    }
  };

  const headerTheme = getHeaderTheme();

  return (
    <div
      className={`relative min-w-[240px] max-w-[280px] rounded-xl overflow-hidden border ${borderColor} bg-zinc-950/95 transition-all duration-200 text-left select-none`}
      style={{ boxShadow }}
    >
      {/* Target handle (Left socket) */}
      {data.type !== "start" && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-zinc-500 hover:!bg-primary !border-2 !border-zinc-950 transition-colors shadow-sm"
        />
      )}

      {/* Blueprint Top Header Banner (Loved in Option 3) */}
      <div
        className={`px-3 py-1.5 flex items-center justify-between text-[10px] font-mono tracking-wider font-semibold ${headerTheme.bg}`}
      >
        <div className="flex items-center gap-1.5">
          {headerTheme.icon}
          <span>{headerTheme.label}</span>
        </div>

        {/* Real-time status / model tag */}
        {isExecuting ? (
          <div className="flex items-center gap-1 text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-[9px] font-bold">RUNNING</span>
          </div>
        ) : isUpdating ? (
          <div className="flex items-center gap-1 text-amber-400">
            <span className="size-1.5 rounded-full bg-amber-400 animate-ping" />
            <span className="text-[9px] font-bold">EDITING</span>
          </div>
        ) : data.config?.model ? (
          <span className="text-[9px] text-zinc-300 opacity-90 truncate max-w-[90px]">
            {String(data.config.model)}
          </span>
        ) : null}
      </div>

      {/* Node Identification & Meta */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="font-semibold text-xs text-zinc-100 tracking-tight leading-snug">
              {data.name}
            </h4>
            <span className="text-[10px] text-zinc-300 font-mono">
              ID: {data.type === "llm" ? "agent_node" : data.type}
            </span>
          </div>

          {/* Model chip */}
          {data.config?.model && hasTools && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-white/5 text-[9px] font-mono text-zinc-400">
              <Cpu className="size-2.5 text-zinc-500" />
              <span>{String(data.config.model)}</span>
            </div>
          )}
        </div>

        {/* OPTION 4: Collapsible Interactive Tool Bar */}
        {hasTools && (
          <div className="mt-2.5">
            {/* Interactive Toggle Pill Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded((prev) => !prev);
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800/90 hover:border-zinc-700 hover:bg-zinc-900 transition-all text-xs font-mono group cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span className="flex items-center -space-x-1.5">
                  {plugins.slice(0, 3).map((p) => (
                    <span
                      key={p}
                      className="size-5 rounded-full bg-zinc-950 border border-zinc-700/80 flex items-center justify-center shadow-xs"
                      title={p}
                    >
                      {getToolIcon(p)}
                    </span>
                  ))}
                </span>
                <span className="text-[10.5px] font-medium text-zinc-300">
                  {plugins.length} Attached Tools
                </span>
              </div>

              <div className="text-zinc-400 group-hover:text-zinc-200 transition-colors">
                {showTools ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </div>
            </button>

            {/* Expanded Detailed Tool Slots */}
            {showTools && (
              <div className="mt-2 space-y-1.5 pt-2 border-t border-zinc-900/80">
                <div className="text-[10px] font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 px-0.5">
                  Tools
                </div>

                {plugins.map((plugin) => {
                  const isToolActive = data.activeTool === plugin && isExecuting;

                  return (
                    <div
                      key={plugin}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-all duration-200 ${
                        isToolActive
                          ? "bg-emerald-500/20 border-emerald-500 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.4)] ring-1 ring-emerald-500/40"
                          : "bg-zinc-900/60 border-zinc-800/80 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/90"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {getToolIcon(plugin)}
                        <span className="truncate text-[11px] font-medium text-zinc-200">
                          {plugin}
                        </span>
                      </div>

                      {isToolActive && (
                        <div className="flex items-center gap-1 shrink-0 bg-emerald-500/20 px-1.5 py-0.5 rounded text-[9px] font-bold text-emerald-300">
                          <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
                          RUNNING
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Source handle (Right socket) */}
      {data.type !== "end" && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !bg-zinc-500 hover:!bg-primary !border-2 !border-zinc-950 transition-colors shadow-sm"
        />
      )}
    </div>
  );
}
