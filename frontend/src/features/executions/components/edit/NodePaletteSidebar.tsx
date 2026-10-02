import type { ReactNode } from "react";
import { Bot, Brain, GitFork, PlayCircle, Puzzle, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaletteNodeType } from "../../types";
import { NODE_DRAG_MIME } from "../../visual-builder";

interface PaletteItem {
  type: PaletteNodeType;
  label: string;
  description: string;
  icon: ReactNode;
  accent: string;
}

const ITEMS: PaletteItem[] = [
  {
    type: "llm",
    label: "LLM",
    description: "Prompts a model and stores its answer",
    icon: <Brain className="size-4" />,
    accent: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  },
  {
    type: "agent",
    label: "Agent",
    description: "LLM with plugins as tools",
    icon: <Bot className="size-4" />,
    accent: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  },
  {
    type: "plugin",
    label: "Plugin",
    description: "Runs a plugin directly",
    icon: <Puzzle className="size-4" />,
    accent: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
  {
    type: "condition",
    label: "Condition",
    description: "Branches the flow on true / false",
    icon: <GitFork className="size-4" />,
    accent: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  },
  {
    type: "start",
    label: "Start",
    description: "Entry point (one per graph)",
    icon: <PlayCircle className="size-4" />,
    accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  {
    type: "end",
    label: "End",
    description: "Delivers the result (one per graph)",
    icon: <StopCircle className="size-4" />,
    accent: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  },
];

interface NodePaletteSidebarProps {
  hasStart: boolean;
  hasEnd: boolean;
}

export function NodePaletteSidebar({ hasStart, hasEnd }: NodePaletteSidebarProps) {
  return (
    <aside className="fixed right-0 top-0 z-30 flex h-screen w-60 flex-col gap-2 border-l border-zinc-800 bg-zinc-950/95 p-4 backdrop-blur-md">
      <div className="mb-1">
        <h3 className="text-sm font-medium text-foreground">Nodes</h3>
        <p className="text-[11px] text-muted-foreground">
          Drag a node onto the canvas, then drag from its handles to connect it.
        </p>
      </div>
      {ITEMS.map((item) => {
        const disabled =
          (item.type === "start" && hasStart) || (item.type === "end" && hasEnd);
        return (
          <div
            key={item.type}
            draggable={!disabled}
            onDragStart={(event) => {
              event.dataTransfer.setData(NODE_DRAG_MIME, item.type);
              event.dataTransfer.effectAllowed = "move";
            }}
            title={disabled ? `The graph already has a ${item.label} node` : undefined}
            className={cn(
              "flex select-none items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 transition-colors",
              disabled
                ? "cursor-not-allowed opacity-40"
                : "cursor-grab hover:border-zinc-600 active:cursor-grabbing",
            )}
          >
            <span className={cn("flex size-8 items-center justify-center rounded-md border", item.accent)}>
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-zinc-100">{item.label}</span>
              <span className="block text-[10px] leading-tight text-zinc-500">{item.description}</span>
            </span>
          </div>
        );
      })}
    </aside>
  );
}
