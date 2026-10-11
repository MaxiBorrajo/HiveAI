import {
  BrainCircuit,
  Check,
  Cloud,
  KeyRound,
  Settings,
  TriangleAlert,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import type { CurrentModels, ModelOptionGroup } from "@/features/models/types";
import {
  currentChoice,
  isCloud,
  sameChoice,
  buildProviderTree,
  type ModelChoice,
  type ProviderModel,
} from "@/features/models/lib/modelChoices";

interface ModelMenuProps {
  groups: ModelOptionGroup[];
  current: CurrentModels;
  onChangeModel: (choice: ModelChoice) => void;
  onOpenManage: () => void;
  onOpenKeys: () => void;
  onOpen?: () => void;
}

function unverifiedTitle(m: ProviderModel): string | undefined {
  return m.toolSupport?.status === "unknown"
    ? `${m.model} — tool support could not be verified. ${m.toolSupport.reason ?? ""}`.trim()
    : undefined;
}

export function ModelMenu({
  groups,
  current,
  onChangeModel,
  onOpenManage,
  onOpenKeys,
  onOpen,
}: ModelMenuProps) {
  const active = currentChoice(current);
  const tree = buildProviderTree(groups);

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
        collisionAvoidance={undefined}
        className="w-72 max-h-[min(24rem,var(--available-height))] overflow-hidden flex flex-col"
      >
        <div className="flex shrink-0 items-center justify-between px-1.5 py-1">
          <span className="text-sm font-medium">Models</span>
          <div className="flex items-center gap-1">
            <DropdownMenuItem
              className="size-7 justify-center p-0"
              title="API keys"
              onClick={onOpenKeys}
            >
              <KeyRound className="size-4" />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="size-7 justify-center p-0"
              title="Manage models"
              onClick={onOpenManage}
            >
              <Settings className="size-4" />
            </DropdownMenuItem>
          </div>
        </div>

        <DropdownMenuGroup className="min-h-0 flex-1 overflow-y-auto">

          {tree.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No models available
            </div>
          )}

          {tree.map((entry) => (
            <div key={entry.provider}>
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground truncate">
                {entry.label}
              </div>
              {entry.keyErrors.map((e) => (
                <div
                  key={e.alias}
                  className="px-2 py-0.5 text-[11px] text-destructive truncate"
                  title={e.error}
                >
                  ⚠ {e.alias}: {e.error}
                </div>
              ))}
              {entry.models.map((m) => {
                const isActive =
                  active.provider === entry.provider &&
                  active.model === m.model;
                const choiceFor = (keyId: string): ModelChoice => ({
                  provider: entry.provider,
                  model: m.model,
                  keyId,
                });

                if (m.keys.length <= 1) {
                  return (
                    <DropdownMenuItem
                      key={m.model}
                      onClick={() => onChangeModel(choiceFor(m.keys[0]?.keyId ?? ""))}
                      title={unverifiedTitle(m) ?? m.model}
                    >
                      <div className="flex flex-1 items-center justify-between gap-2 min-w-0 px-2">
                        <span className="text-sm font-mono truncate max-w-48">
                          {m.model}
                        </span>
                        {m.toolSupport?.status === "unknown" && (
                          <TriangleAlert className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {isActive && <Check className="size-4 shrink-0" />}
                      </div>
                    </DropdownMenuItem>
                  );
                }

                return (
                  <DropdownMenuSub key={m.model}>
                    <DropdownMenuSubTrigger title={unverifiedTitle(m) ?? m.model}>
                      <div className="flex flex-1 items-center justify-between gap-2 min-w-0 px-2">
                        <span className="text-sm font-mono truncate max-w-40">
                          {m.model}
                        </span>
                        {m.toolSupport?.status === "unknown" && (
                          <TriangleAlert className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {isActive && <Check className="size-4 shrink-0" />}
                      </div>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56">
                      <div className="px-2 py-1 text-xs text-muted-foreground">
                        API key
                      </div>
                      {m.keys.map((k) => (
                        <DropdownMenuItem
                          key={k.keyId}
                          onClick={() => onChangeModel(choiceFor(k.keyId))}
                        >
                          <div className="flex flex-1 items-center justify-between gap-2 min-w-0 px-2">
                            <span className="text-sm truncate">{k.alias}</span>
                            {sameChoice(choiceFor(k.keyId), active) && (
                              <Check className="size-4 shrink-0" />
                            )}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                );
              })}
            </div>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
