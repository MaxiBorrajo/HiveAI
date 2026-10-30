import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TestSuiteQualityReport } from "../types";

interface InstallBarProps {
  qualityReport: TestSuiteQualityReport | null;
  isInstalling: boolean;
  onInstall: () => void;
  onDiscard: () => void;
}

export function InstallBar({
  qualityReport,
  isInstalling,
  onInstall,
  onDiscard,
}: InstallBarProps) {
  const canInstall = !!qualityReport?.valid;

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {canInstall
          ? `Quality checks passed (${qualityReport?.total} tests).`
          : "Fix the quality validator issues in the Tests tab before installing."}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Discard
        </button>
        <button
          type="button"
          disabled={!canInstall || isInstalling}
          onClick={onInstall}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            canInstall
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {isInstalling && <Loader2 className="size-3.5 animate-spin" />}
          Install plugin
        </button>
      </div>
    </div>
  );
}
