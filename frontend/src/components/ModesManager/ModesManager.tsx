import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { Cog, Sparkles, User, Zap } from "lucide-react";
import type { ChatMode } from "../../types/chat.ts";

export function ModesManager() {
  const [modes, setModes] = useState<ChatMode[]>([
    {
      name: "Fast",
      description: "Fast mode for quick responses",
      icon: <Zap className="size-4" />,
    },
    {
      name: "Quality",
      description: "High-quality mode for detailed responses",
      icon: <Sparkles className="size-4" />,
    },
    {
      name: "Custom",
      description: "Custom mode for user-defined settings",
      icon: <Cog className="size-4" />,
    },
    {
      name: "Default",
      description: "Default mode with balanced performance",
      icon: <User className="size-4" />,
    },
  ]);

  const [currentMode, setCurrentMode] = useState<ChatMode>({
    name: "Default",
    description: "Default mode with balanced performance",
    icon: <User className="size-4" />,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring px-1"
        title="Modes"
      >
        <ModeOption mode={currentMode} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-56"
      >
        {modes.map((mode) => (
          <>
            {mode.parameters ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ModeOption mode={mode} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem></DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem
                key={mode.name}
                closeOnClick={false}
                title={mode.description}
                onClick={() => setCurrentMode(mode)}
              >
                <ModeOption mode={mode} />
              </DropdownMenuItem>
            )}
          </>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ModeOption({ mode }: { mode: ChatMode }) {
  return (
    <div className="flex flex-1 items-center gap-2 p-0.5">
      {mode.icon}
      <span className="text-sm font-mono truncate">{mode.name}</span>
    </div>
  );
}
