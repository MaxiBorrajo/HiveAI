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
    <div className="inline-flex items-stretch divide-x divide-zinc-800/80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/90 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-zinc-300">
        <span className={cn("size-2 rounded-full", isDirty ? "bg-amber-400" : "bg-zinc-600")} />
        {isDirty ? "Unsaved changes" : "Editing"}
      </div>
      <button
        type="button"
        onClick={onToggleState}
        className={cn(
          "flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium transition-colors hover:bg-zinc-900",
          isStateOpen ? "bg-zinc-800/90 text-zinc-100" : "text-zinc-400 hover:text-zinc-200",
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
        className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Save
      </button>
      <button
        type="button"
        onClick={onDiscard}
        disabled={disabled || isSaving}
        className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <X className="size-3.5" />
        Discard
      </button>
    </div>
  );
}
