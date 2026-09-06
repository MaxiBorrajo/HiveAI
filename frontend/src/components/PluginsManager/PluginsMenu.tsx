import { Blocks, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import type { Plugin } from "@/types/plugin";

interface PluginsMenuProps {
  plugins: Plugin[];
  onToggle: (plugin: Plugin, nextActive: boolean) => void;
  onToggleAll: (nextActive: boolean) => void;
  onOpenManage: () => void;
  // The trigger sits mid-screen in the empty-chat welcome layout, where
  // Base UI's automatic flip miscalculates and opens the menu upward even
  // though there's real space below. Force it downward only in that layout;
  // once there are messages the trigger sits at the bottom of the screen and
  // needs the normal automatic flip (to open upward) to stay on-screen.
  forceOpenDownward?: boolean;
}

export function PluginsMenu({
  plugins,
  onToggle,
  onToggleAll,
  onOpenManage,
  forceOpenDownward = false,
}: PluginsMenuProps) {
  const allActive = plugins.length > 0 && plugins.every((p) => p.active);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center justify-center rounded-md size-8 hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title="Plugins"
      >
        <Blocks className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionAvoidance={forceOpenDownward ? { side: "none" } : undefined}
        className="w-56"
      >
        <DropdownMenuGroup>
          <div className="flex flex-1 items-center justify-between  gap-1.5 px-1.5 py-1">
            <span className="text-sm font-semibold">Quick Plugins</span>
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Switch
                checked={allActive}
                onCheckedChange={(checked) => onToggleAll(checked)}
                disabled={plugins.length === 0}
                title="Toggle all plugins"
              />
            </div>
          </div>

          <DropdownMenuSeparator />

          {plugins.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No plugins available
            </div>
          ) : (
            plugins.map((plugin) => (
              <DropdownMenuItem key={plugin.id} closeOnClick={false}>
                <div className="flex flex-1 items-center justify-between gap-2">
                  <span className="text-sm font-mono truncate">
                    {plugin.name}
                  </span>
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={plugin.active}
                      onCheckedChange={(checked) => onToggle(plugin, checked)}
                    />
                  </div>
                </div>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onOpenManage}>
          <Settings className="mr-2 size-4" />
          <span>Manage Plugins...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
