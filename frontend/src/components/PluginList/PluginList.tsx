import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlugins } from "@/lib/get-plugins";
import type { Plugin } from "@/types/plugin";

interface PluginListProps {
  selectedIds: string[];
  onToggle: (id: string) => void;
}

export function PluginList({ selectedIds = [], onToggle }: PluginListProps) {
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);

  useEffect(() => {
    getPlugins().then(setPlugins);
  }, []);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-border">
      <div className="flex h-16 items-center border-b border-border px-4">
        <h2 className="text-xs font-mono text-muted-foreground">Plugins</h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-4">
          {plugins === null && (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          )}

          {plugins?.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No hay plugins registrados.
            </p>
          )}

          {plugins?.map((plugin) => (
            <label
              key={plugin.id}
              htmlFor={`plugin-${plugin.id}`}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3"
            >
              <input
                id={`plugin-${plugin.id}`}
                type="checkbox"
                checked={selectedIds.includes(plugin.id)}
                onChange={() => onToggle(plugin.id)}
                className="mt-0.5 size-3.5 shrink-0 accent-primary"
              />
              <div>
                <p className="text-xs font-mono text-foreground">
                  {plugin.name}
                </p>
                <p className="text-muted-foreground text-xs mt-1">
                  {plugin.description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
