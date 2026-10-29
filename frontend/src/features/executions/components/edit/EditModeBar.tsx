import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Database,
  LayoutGrid,
  Loader2,
  Save,
  Undo2,
  X,
} from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LayoutDirection } from "../../visual-builder/layoutDirection";

const ARRANGE_OPTIONS: {
  direction: LayoutDirection;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { direction: "TB", label: "Top to bottom", hint: "Reads like a page", icon: ArrowDown },
  { direction: "LR", label: "Left to right", hint: "Default", icon: ArrowRight },
  { direction: "BT", label: "Bottom to top", hint: "", icon: ArrowUp },
  { direction: "RL", label: "Right to left", hint: "", icon: ArrowLeft },
];

interface EditModeBarProps {
  isDirty: boolean;
  isSaving: boolean;
  disabled?: boolean;
  isStateOpen: boolean;
  onToggleState: () => void;
  canUndoArrange: boolean;
  onArrange: (direction: LayoutDirection) => void;
  onUndoArrange: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

export function EditModeBar({
  isDirty,
  isSaving,
  disabled,
  isStateOpen,
  onToggleState,
  canUndoArrange,
  onArrange,
  onUndoArrange,
  onSave,
  onDiscard,
}: EditModeBarProps) {
  return (
    <div className="inline-flex items-stretch divide-x divide-border/80 overflow-hidden rounded-xl border border-border bg-card/90 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-muted-foreground">
        <span className={cn("size-2 rounded-full", isDirty ? "bg-amber-400" : "bg-muted-foreground/50")} />
        {isDirty ? "Unsaved changes" : "Editing"}
      </div>
      <button
        type="button"
        onClick={onToggleState}
        className={cn(
          "flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium transition-colors hover:bg-muted",
          isStateOpen ? "bg-muted/90 text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        title="Show the graph's state variables"
      >
        <Database className="size-3.5" />
        State
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled || isSaving}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          title="Arrange the nodes following the flow direction"
        >
          <LayoutGrid className="size-3.5" />
          Arrange
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="w-52">
          {ARRANGE_OPTIONS.map(({ direction, label, hint, icon: Icon }) => (
            <DropdownMenuItem key={direction} onClick={() => onArrange(direction)}>
              <Icon className="mr-2 size-4" />
              <span className="flex-1 text-sm">{label}</span>
              {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {canUndoArrange && (
        <button
          type="button"
          onClick={onUndoArrange}
          disabled={disabled || isSaving}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          title="Restore the previous node positions"
        >
          <Undo2 className="size-3.5" />
          Undo
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || isSaving || !isDirty}
        className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Save
      </button>
      <button
        type="button"
        onClick={onDiscard}
        disabled={disabled || isSaving}
        className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <X className="size-3.5" />
        Discard
      </button>
    </div>
  );
}
