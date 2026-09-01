import { Blocks, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import type { Plugin } from "@/types/plugin";

interface PluginsMenuProps {
  plugins: Plugin[];
  onToggle: (plugin: Plugin, nextActive: boolean) => void;
  onOpenManage: () => void;
}

export function PluginsMenu({
  plugins,
  onToggle,
  onOpenManage,
}: PluginsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center justify-center rounded-md size-8 hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title="Plugins"
      >
        <Blocks className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Quick Plugins</DropdownMenuLabel>

          {plugins.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No plugins available
            </div>
          ) : (
            plugins.map((plugin) => (
              <DropdownMenuItem
                key={plugin.id}
                onClick={(e) => e.preventDefault()}
              >
                <div className="flex flex-1 items-center justify-between gap-2">
                  <span className="text-sm font-mono truncate">
                    {plugin.name}
                  </span>
                  <Switch
                    checked={plugin.active}
                    onCheckedChange={(checked) => onToggle(plugin, checked)}
                  />
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
