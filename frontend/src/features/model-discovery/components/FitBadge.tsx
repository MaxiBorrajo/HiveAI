import { Badge } from "@/components/ui/badge";
import { FIT_LABEL, FIT_VARIANT } from "../lib/fit";
import type { FitResult } from "../types";

export function FitBadge({ fit }: { fit: FitResult | null }) {
  if (!fit) return <Badge variant="outline" data-testid="fit-badge">Size unknown</Badge>;
  return (
    <Badge variant={FIT_VARIANT[fit.status]} title={fit.reason} data-testid="fit-badge">
      {FIT_LABEL[fit.status]}
    </Badge>
  );
}

export function CapabilityBadges({
  capabilities,
}: {
  capabilities: { tools: boolean; vision: boolean; reasoning: boolean };
}) {
  return (
    <>
      {capabilities.tools && <Badge variant="outline">Tools</Badge>}
      {capabilities.vision && <Badge variant="outline">Vision</Badge>}
      {capabilities.reasoning && <Badge variant="outline">Reasoning</Badge>}
    </>
  );
}
