import { Cpu, Info, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import type { Model } from "../../types/ai.ts";

interface ModelsMenuProps {
  models: Model[];
  currentModel?: Model;
  onToggle: (model: Model) => void;
  onOpenManage: () => void;
}

export function ModelsMenu({
  models,
  currentModel,
  onToggle,
  onOpenManage,
}: ModelsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center justify-center rounded-md size-8 hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title="Models"
      >
        <Cpu className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Models</DropdownMenuLabel>

          {models.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No models available
            </div>
          ) : (
            models.map((model) => (
              <DropdownMenuItem
                key={model.name}
                onClick={() => onToggle(model)}
                className={
                  currentModel?.name === model.name ? "bg-accent/50" : ""
                }
              >
                <div className="flex flex-1 items-center justify-between gap-2">
                  <span className="text-sm font-mono truncate">
                    {model.name}
                  </span>
                  {currentModel?.name === model.name && (
                    <Check className="size-4 text-primary" />
                  )}
                </div>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onOpenManage}>
          <Info className="mr-2 size-4" />
          <span>Model Details</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
