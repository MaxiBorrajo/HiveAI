import { useState, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";

const BEE_PHRASES = [
  "Pollinating ideas...",
  "Distilling data nectar...",
  "Building the honeycomb...",
  "Buzzing connections...",
  "Harvesting information...",
  "Aligning worker bees...",
  "Refining royal jelly...",
  "Structuring cells...",
  "Mapping the hive...",
];

export function GhostNode({ data }: { data?: { label?: string } }) {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % BEE_PHRASES.length);
    }, 2400);
    return () => clearInterval(interval);
  }, []);

  const displayPhrase = data?.label || BEE_PHRASES[phraseIndex];

  return (
    <div className="relative group">
      <Handle
        type="target"
        position={Position.Left}
        className="bg-primary! w-2.5! h-2.5!"
      />

      <div className="px-3.5 py-2.5 rounded-lg border-2 border-dashed border-primary/70 bg-background/95 text-primary font-sans shadow-[0_0_16px_rgba(245,158,11,0.2)] flex items-center justify-center min-w-45 max-w-64 transition-all duration-300 animate-pulse">
        {data?.label ? (
          <div className="flex flex-col text-left w-full overflow-hidden">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="size-2 rounded-full bg-primary animate-ping shrink-0" />
              <span className="text-[10px] uppercase font-semibold text-primary/90 tracking-wider">
                Forming node...
              </span>
            </div>
            <span className="text-[11px] text-zinc-300 line-clamp-2 leading-snug">
              {data.label}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-0.5">
            <span className="size-2 rounded-full bg-primary animate-ping shrink-0" />
            <span className="text-xs font-medium tracking-wide">
              {displayPhrase}
            </span>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="bg-primary! w-2.5! h-2.5!"
      />
    </div>
  );
}
