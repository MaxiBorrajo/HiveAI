import { Database, Loader2, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditModeBarProps {
  isDirty: boolean;
  isSaving: boolean;
  disabled?: boolean;
  isStateOpen: boolean;
  onToggleState: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

export function EditModeBar({
  isDirty,
  isSaving,
  disabled,
  isStateOpen,
  onToggleState,
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
