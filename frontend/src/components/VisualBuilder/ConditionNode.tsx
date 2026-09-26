import { Handle, Position } from "@xyflow/react";

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
  data,
  selected,
}: {
  id: string;
  data: ConditionNodeData;
  selected?: boolean;
}) {
  const isSelected = selected || data.isSelected;
  const isActive = data.isActive;
  const isUpdating = data.isUpdating;
  const isExecuting = data.isExecuting || (isActive && !isUpdating);

  let borderColor = "var(--border, #3f3f46)";
  let boxShadow = "none";
  let bgColor = "var(--muted, #27272a)";

  if (isUpdating) {
    borderColor = "#f59e0b";
    boxShadow = "0 0 20px rgba(245, 158, 11, 0.7)";
    bgColor = "rgba(245, 158, 11, 0.15)";
  } else if (isExecuting) {
    borderColor = "#10b981";
    boxShadow = "0 0 24px rgba(16, 185, 129, 0.75)";
    bgColor = "rgba(16, 185, 129, 0.15)";
  } else if (isActive) {
    borderColor = "var(--primary)";
    boxShadow = "0 0 14px var(--primary)";
    bgColor = "var(--secondary, #3f3f46)";
  } else if (isSelected) {
    borderColor = "var(--primary)";
    boxShadow = "0 0 10px var(--primary)";
    bgColor = "var(--secondary, #3f3f46)";
  }

  const rule = formatRule(data.config?.condition);

  return (
    <div className="relative w-[110px] h-[110px] flex items-center justify-center cursor-pointer select-none">
      {/* Rotated diamond box - square aspect ratio, styled identical to standard nodes */}
      <div
        className="absolute w-[74px] h-[74px] rounded-[6px] transition-all duration-200"
        style={{
          transform: "rotate(45deg)",
          background: bgColor,
          border: `1.5px solid ${borderColor}`,
          boxShadow,
        }}
      />

      {/* Target handle on Left corner */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        style={{
          left: 2,
          top: "50%",
          transform: "translateY(-50%)",
        }}
        className="!w-2 !h-2 !bg-muted-foreground border-none"
      />

      {/* Source handle on Right corner for TRUE path */}
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{
          right: 2,
          top: "50%",
          transform: "translateY(-50%)",
        }}
        className="!w-2 !h-2 !bg-green-500 border-none"
      />

      {/* Source handle on Bottom corner for FALSE path */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{
          bottom: 2,
          left: "50%",
          transform: "translateX(-50%)",
        }}
        className="!w-2 !h-2 !bg-red-500 border-none"
      />

      {/* Center content - strictly horizontal, never rotated */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center p-1 max-w-[70px] pointer-events-none">
        {isUpdating && (
          <span className="size-2 rounded-full bg-amber-400 animate-ping shrink-0 mb-1" />
        )}
        {isExecuting && (
          <span className="size-2 rounded-full bg-emerald-400 animate-ping shrink-0 mb-1" />
        )}
        <span className="text-[11px] font-medium text-foreground leading-tight line-clamp-2">
          {data.name || "Condition"}
        </span>
        {rule ? (
          <span className="text-[9px] text-muted-foreground font-mono leading-tight mt-0.5 break-all line-clamp-2">
            {rule}
          </span>
        ) : (
          <span className="text-[9px] text-muted-foreground capitalize mt-0.5">
            decision
          </span>
        )}
      </div>
    </div>
  );
}

