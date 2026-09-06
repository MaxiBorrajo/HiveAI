import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TestTube } from "lucide-react";
import type { Plugin } from "@/types/plugin";

interface PluginListViewProps {
  plugins: Plugin[];
  onToggle: (plugin: Plugin, nextActive: boolean) => void;
  onToggleAll: (nextActive: boolean) => void;
  onSelectPlugin: (name: string) => void;
}

export function PluginListView({
  plugins,
  onToggle,
  onToggleAll,
  onSelectPlugin,
}: PluginListViewProps) {
  const allActive = plugins.length > 0 && plugins.every((p) => p.active);

  return (
    <>
      <DialogHeader className="p-6 pb-0 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <DialogTitle>Manage Plugins</DialogTitle>
          <div title="Toggle all plugins">
            <Switch
              checked={allActive}
              onCheckedChange={(checked) => onToggleAll(checked)}
              disabled={plugins.length === 0}
            />
          </div>
        </div>
      </DialogHeader>

      <ScrollArea className="flex-1 p-6 pt-2">
        <div className="flex flex-col gap-3">
          {plugins.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No plugins registered.
            </p>
          )}

          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-semibold items-center flex gap-2 mb-2">
                    <Switch
                      checked={plugin.active}
                      onCheckedChange={(checked) => onToggle(plugin, checked)}
                      className="mt-0.5"
                    />{" "}
                    {plugin.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plugin.description}
                  </p>
                </div>

                {((plugin.selectionTests && plugin.selectionTests.length > 0) ||
                  (plugin.executionTests &&
                    plugin.executionTests.length > 0)) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onSelectPlugin(plugin.name)}
                    className="shrink-0 h-8 gap-1 px-3"
                  >
                    <TestTube size={12} />
                    <span>Tests</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}
