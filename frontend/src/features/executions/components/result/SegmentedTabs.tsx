import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
  badge?: number;
}

interface SegmentedTabsProps<T extends string> {
  tabs: SegmentedTab<T>[];
  active: T;
  onChange: (id: T) => void;
}

export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
}: SegmentedTabsProps<T>) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-muted border border-border/80 text-xs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all cursor-pointer",
            active === tab.id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.badge !== undefined && (
            <span className="text-[10px] font-mono px-1 rounded bg-card text-muted-foreground">
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
