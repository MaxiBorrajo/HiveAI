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

      <div className="px-4 py-3 rounded-lg border-2 border-primary/80 bg-background/90 text-primary font-sans shadow-[0_0_20px_var(--color-primary),inset_0_0_10px_var(--color-primary)] opacity-80 flex items-center gap-2.5 min-w-47.5 justify-center transition-all duration-700 animate-pulse">
        <span className="text-xs font-medium tracking-wide transition-opacity duration-300">
          {displayPhrase}
        </span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="bg-primary! w-2.5! h-2.5!"
      />
    </div>
  );
}
