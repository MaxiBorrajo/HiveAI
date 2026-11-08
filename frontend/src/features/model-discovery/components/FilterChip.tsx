import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}

export function FilterChip({ active, onClick, children, testId }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
