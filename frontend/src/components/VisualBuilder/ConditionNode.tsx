import { useState, useEffect, useRef } from "react";
import { Handle, Position } from "@xyflow/react";
import { GitFork } from "lucide-react";

export interface ConditionNodeData {
  name: string;
  config?: {
    condition?: {
      field: string;
      operator: string;
      value: unknown;
    };
    [key: string]: unknown;
  };
  isActive?: boolean;
  isUpdating?: boolean;
  isExecuting?: boolean;
  isSelected?: boolean;
}

function formatRule(condition?: {
  field: string;
  operator: string;
  value: unknown;
}): string {
  if (!condition || !condition.field) return "";
  const opMap: Record<string, string> = {
    equals: "==",
    not_equals: "!=",
    greater_than: ">",
    greater_than_or_equals: ">=",
    less_than: "<",
    less_than_or_equals: "<=",
    contains: "contains",
    not_contains: "!contains",
    starts_with: "starts with",
    ends_with: "ends with",
    is_empty: "is empty",
    is_not_empty: "not empty",
    in: "in",
    not_in: "!in",
    regex_match: "matches",
  };
  const op = opMap[condition.operator] || condition.operator;
  if (condition.operator === "is_empty" || condition.operator === "is_not_empty") {
    return `${condition.field} ${op}`;
  }
  const val =
    typeof condition.value === "string"
      ? `"${condition.value}"`
      : JSON.stringify(condition.value);
  return `${condition.field} ${op} ${val ?? ""}`;
}

export function ConditionNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: ConditionNodeData;
  selected?: boolean;
}) {
  const isSelected = selected || data.isSelected;
  const isUpdating = data.isUpdating;
  const isExecuting = data.isExecuting;

  // Thin 1px border matching StandardNode
  let borderColor = "#27272a"; // border-zinc-800
  let filter = "drop-shadow(0 8px 24px rgba(0,0,0,0.5))";

  if (isUpdating) {
    borderColor = "#f97316"; // border-orange-500
    filter = "drop-shadow(0 0 24px rgba(249, 115, 22, 0.45))";
  } else if (isExecuting) {
    borderColor = "#10b981"; // border-emerald-500
    filter = "drop-shadow(0 0 28px rgba(16, 185, 129, 0.55))";
  } else if (isSelected) {
    borderColor = "var(--primary, #3b82f6)";
    filter = "drop-shadow(0 0 16px rgba(59, 130, 246, 0.4))";
  }

  const rule = formatRule(data.config?.condition);

  // Self-adapting height measurement so any content length fits without being cut off
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodeHeight, setNodeHeight] = useState(136);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const measured = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
        if (measured > 0 && Math.abs(measured - nodeHeight) > 1) {
          setNodeHeight(measured);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [nodeHeight, rule, data.name]);

  return (
    <div
      ref={containerRef}
      className="relative w-[260px] min-h-[136px] overflow-hidden cursor-pointer select-none text-left"
      style={{ filter }}
    >
      {/* Target handle on Left edge - Semicircle socket cut into the edge via overflow-hidden */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!w-3 !h-3 !bg-zinc-500 hover:!bg-primary !border-2 !border-zinc-950 transition-colors shadow-sm z-20"
      />

      {/* Adaptive Chamfered Corner-Cut 45° SVG that scales to exact node height */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 260 ${nodeHeight}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* 1. Full Chamfered Card Body with thin 1px border */}
        <path
          d={`M 14 1 L 246 1 L 259 14 L 259 ${nodeHeight - 14} L 246 ${nodeHeight - 1} L 14 ${nodeHeight - 1} L 1 ${nodeHeight - 14} L 1 14 Z`}
          fill="rgba(9, 9, 11, 0.95)"
          stroke={borderColor}
          strokeWidth="1"
          className="transition-colors duration-200"
        />

        {/* 2. Top Blueprint Header (Flat solid orange tint, no gradient) */}
        <path
          d="M 14 1 L 246 1 L 259 14 L 259 28 L 1 28 L 1 14 Z"
          fill="rgba(249, 115, 22, 0.12)"
        />

        {/* 3. Header Divider Line (Thin 1px) */}
        <line
          x1="1"
          y1="28"
          x2="259"
          y2="28"
          stroke="rgba(249, 115, 22, 0.35)"
          strokeWidth="1"
        />
      </svg>

      {/* Blueprint Header Content */}
      <div className="relative z-10 px-3.5 py-1.5 h-[28px] flex items-center justify-between text-orange-400 pointer-events-none">
        <div className="flex items-center gap-1.5">
          <GitFork className="size-3.5 shrink-0 text-orange-400" />
          <span className="text-[10px] font-mono font-semibold tracking-wider uppercase text-orange-300">
            CONDITION ROUTER
          </span>
        </div>

        {isExecuting ? (
          <div className="flex items-center gap-1 text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-[8px] font-bold">RUNNING</span>
          </div>
        ) : isUpdating ? (
          <div className="flex items-center gap-1 text-orange-400">
            <span className="size-1.5 rounded-full bg-orange-400 animate-ping" />
            <span className="text-[8px] font-bold">EDITING</span>
          </div>
        ) : (
          <span className="text-[9px] text-orange-400/60 font-mono">LOGIC</span>
        )}
      </div>

      {/* Card Body Content - Normal flow, adaptive, with user's mt-2 and ample pb-4.5 */}
      <div className="relative z-10 px-3.5 pt-2.5 pb-4.5 flex flex-col pointer-events-none">
        {/* Title and ID block */}
        <div className="text-left">
          <h4
            className="font-semibold text-xs text-zinc-100 tracking-tight leading-snug break-words"
            title={data.name}
          >
            {data.name || "Condition"}
          </h4>
          <span className="text-[10px] text-zinc-400 font-mono">
            ID: {id || "condition"}
          </span>
        </div>

        {/* Rule expression pill - Preserving user's mt-2, fully visible with clearance above bottom handle */}
        {rule ? (
          <div
            className="px-2.5 py-1 rounded-md bg-zinc-900/90 border border-orange-500/30 text-[10.5px] text-orange-300 font-mono leading-tight shadow-sm text-left mt-2 break-all"
            title={rule}
          >
            {rule}
          </div>
        ) : (
          <div className="text-[10px] text-zinc-500 font-mono text-left mt-2">
            evaluating condition...
          </div>
        )}
      </div>

      {/* Source handle on Right edge for TRUE path - Semicircle socket cut into the edge */}
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        className="!w-3 !h-3 !bg-emerald-500 hover:!bg-emerald-400 !border-2 !border-zinc-950 transition-colors shadow-sm z-20"
      />

      {/* Source handle on Bottom edge for FALSE path - Semicircle socket cut into the bottom edge */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="!w-3 !h-3 !bg-red-500 hover:!bg-red-400 !border-2 !border-zinc-950 transition-colors shadow-sm z-20"
      />
    </div>
  );
}

