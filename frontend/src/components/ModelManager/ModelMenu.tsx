import { BrainCircuit, Check, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { CurrentModels, ModelInfo } from "@/types/model";

interface ModelMenuProps {
  models: ModelInfo[];
  current: CurrentModels;
  onChangeModel: (name: string) => void;
  onChangeSelectorModel: (name: string) => void;
  onOpenManage: () => void;
  onOpen?: () => void;
  forceOpenDownward?: boolean;
}

export function ModelMenu({
  models,
  current,
  onChangeModel,
  onChangeSelectorModel,
  onOpenManage,
  onOpen,
  forceOpenDownward = false,
}: ModelMenuProps) {
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
        <BrainCircuit className="size-4" />
        <span className="text-sm font-mono truncate max-w-32">
          {current.model || "No model"}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionAvoidance={forceOpenDownward ? { side: "none" } : undefined}
        className="w-64"
      >
        <DropdownMenuGroup>
          <div className="px-1.5 py-1">
            <span className="text-sm font-medium">Models</span>
          </div>

          <DropdownMenuSeparator />

          {models.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No models available
            </div>
          ) : (
            models.map((model) => {
              const isModel = model.name === current.model;
              const isSelectorModel = model.name === current.selectorModel;

              return (
                <DropdownMenuSub key={model.name}>
                  <DropdownMenuSubTrigger title={model.name}>
                    <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                      <span className="text-sm font-mono truncate max-w-40">
                        {model.name}
                      </span>
                      {(isModel || isSelectorModel) && (
                        <Check className="size-4 shrink-0" />
                      )}
                    </div>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent sideOffset={10}>
                    <DropdownMenuItem
                      closeOnClick={false}
                      onClick={() => onChangeModel(model.name)}
                      title="Used to respond to messages and verify results. Prefer a larger, more capable model here."
                    >
                      <div className="flex flex-1 items-center justify-between gap-2">
                        <span className="text-sm">To respond/verify</span>
                        {isModel && <Check className="size-4 shrink-0" />}
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      closeOnClick={false}
                      onClick={() => onChangeSelectorModel(model.name)}
                      title="Used to quickly select which plugins to run. Prefer a smaller, faster model here."
                    >
                      <div className="flex flex-1 items-center justify-between gap-2">
                        <span className="text-sm">To select plugins</span>
                        {isSelectorModel && (
                          <Check className="size-4 shrink-0" />
                        )}
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onOpenManage}>
          <Settings className="mr-2 size-4" />
          <span>Manage Models...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
