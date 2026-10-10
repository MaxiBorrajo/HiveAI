import { BrainCircuitIcon, CloudIcon } from "lucide-react";
import type { UsageLocation } from "../types.ts";

// Same icons the model menu uses, so local vs cloud reads the same everywhere.
export function UsageLocationIcon({
  location,
  className = "size-3 shrink-0",
}: {
  location: UsageLocation;
  className?: string;
}) {
  const label = location === "cloud" ? "Cloud" : "Local";
  return location === "cloud" ? (
    <CloudIcon className={className} aria-label={label} role="img" />
  ) : (
    <BrainCircuitIcon className={className} aria-label={label} role="img" />
  );
}
