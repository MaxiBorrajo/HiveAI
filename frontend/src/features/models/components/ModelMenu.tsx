import { BrainCircuit, Check, Cloud, KeyRound, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import type {
  CurrentModels,
  ModelOptionGroup,
} from "@/features/models/types";
import {
  currentChoice,
  isCloud,
  sameChoice,
  toChoice,
  type ModelChoice,
} from "@/features/models/lib/modelChoices";

interface ModelMenuProps {
  groups: ModelOptionGroup[];
  current: CurrentModels;
  onChangeModel: (choice: ModelChoice) => void;
  onOpenManage: () => void;
  onOpenKeys: () => void;
  onOpen?: () => void;
  forceOpenDownward?: boolean;
}

export function ModelMenu({
  groups,
  current,
  onChangeModel,
  onOpenManage,
  onOpenKeys,
  onOpen,
  forceOpenDownward = false,
}: ModelMenuProps) {
  const active = currentChoice(current);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <DropdownMenuTrigger
        className="flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring px-1.5 py-0.5 gap-2"
        title="Models"
      >
        {isCloud(current.provider) ? (
          <Cloud className="size-4" />
        ) : (
          <BrainCircuit className="size-4" />
        )}
        <span className="text-sm font-mono truncate max-w-32">
          {current.model || "No model"}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionAvoidance={forceOpenDownward ? { side: "none" } : undefined}
        className="w-72 max-h-96 overflow-y-auto"
      >
        <DropdownMenuGroup>
          <div className="px-1.5 py-1">
            <span className="text-sm font-medium">Models</span>
          </div>

          {groups.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No models available
            </div>
          )}

          {groups.map((group) => (
            <div key={group.id}>
              <DropdownMenuSeparator />
              <div
                className="px-2 py-1 text-xs font-medium text-muted-foreground truncate"
                title={group.error}
              >
                {group.label}
                {group.error && " ⚠"}
              </div>
              {group.options.map(toChoice).map((choice) => (
                <DropdownMenuItem
                  key={`${group.id}:${choice.model}`}
                  closeOnClick={false}
                  onClick={() => onChangeModel(choice)}
                  title={choice.model}
                >
                  <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                    <span className="text-sm font-mono truncate max-w-48">
                      {choice.model}
                    </span>
                    {sameChoice(choice, active) && (
                      <Check className="size-4 shrink-0" />
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onOpenKeys}>
          <KeyRound className="mr-2 size-4" />
          <span>API keys...</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenManage}>
          <Settings className="mr-2 size-4" />
          <span>Manage Models...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
