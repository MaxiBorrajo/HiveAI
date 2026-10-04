import { PencilRuler } from "lucide-react";
import { Logo } from "../../../components/Logo";

interface EmptyStateHeaderProps {
  onCreateManually: () => void;
}

export function EmptyStateHeader({ onCreateManually }: EmptyStateHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-center gap-1">
        <Logo size={20} />
        <h1 className="text-display text-lg font-medium">HiveAI</h1>
      </div>
      <button
        type="button"
        onClick={onCreateManually}
        className="pointer-events-auto ml-4 flex items-center gap-1.5 rounded-xl border border-border bg-card/90 px-3 py-2 text-xs font-medium text-muted-foreground shadow-2xl backdrop-blur-md transition-colors hover:bg-muted hover:text-foreground"
        title="Build an execution by hand instead of describing it"
      >
        <PencilRuler className="size-3.5" />
        Create manually
      </button>
    </>
  );
}
