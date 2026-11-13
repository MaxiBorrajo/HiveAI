import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/features/models/lib/formatBytes";
import { formatContext, formatCount } from "../lib/fit";
import type { ModelSource, SearchResultItem } from "../types";
import { CapabilityBadges, FitBadge } from "./FitBadge";

interface ModelResultItemProps {
  item: SearchResultItem;
  onSelect: (id: string, source: ModelSource) => void;
  /** Why this model was suggested, when it came from the advisor */
  reason?: string;
}

export function ModelResultItem({ item: { card, fit, estimatedQ4Bytes }, onSelect, reason }: ModelResultItemProps) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(card.id, card.source)}
        data-testid={`model-result-${card.id}`}
        className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-left hover:bg-muted/50"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
            {card.id}
          </span>
          <FitBadge fit={fit} />
        </div>
        {reason && (
          <p className="text-xs text-foreground" data-testid="model-result-advice">
            {reason}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {card.sizes && card.sizes.length > 0 ? (
            <Badge variant="secondary" data-testid="model-result-sizes">
              {card.sizes.map((z) => `${z}B`).join(" · ")}
            </Badge>
          ) : card.paramsBillions !== null && (
            <Badge variant="secondary">{card.paramsBillions}B params</Badge>
          )}
          <CapabilityBadges capabilities={card.capabilities} />
          {estimatedQ4Bytes !== null && (
            <span>
              {card.sizes && card.sizes.length > 1 && card.paramsBillions !== null
                ? `${card.paramsBillions}B: `
                : ""}~{formatBytes(estimatedQ4Bytes)} at 4-bit
            </span>
          )}
          {formatContext(card.contextLength) && (
            <span>· {formatContext(card.contextLength)}</span>
          )}
          {card.downloads > 0 && <span>· {formatCount(card.downloads)} downloads</span>}
        </div>
        {fit && (
          <p className="text-xs text-muted-foreground" data-testid="model-result-reason">
            {fit.reason}
          </p>
        )}
      </button>
    </li>
  );
}
