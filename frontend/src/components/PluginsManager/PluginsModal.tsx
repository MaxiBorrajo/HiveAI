import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Plugin } from "@/types/plugin";
import { PluginListView } from "./PluginListView";
import { PluginTestsView } from "./PluginTestsView";

interface PluginsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  plugins: Plugin[];
  onToggle: (plugin: Plugin, nextActive: boolean) => void;
  onToggleAll: (nextActive: boolean) => void;
}

export function PluginsModal({
  isOpen,
  onOpenChange,
  plugins,
  onToggle,
  onToggleAll,
}: PluginsModalProps) {
  const [selectedPluginName, setSelectedPluginName] = useState<string | null>(
    null,
  );

  // Reset internal view when modal closes
  function handleOpenChange(open: boolean) {
    if (!open) setSelectedPluginName(null);
    onOpenChange(open);
  }

  const selectedPlugin = plugins.find((p) => p.name === selectedPluginName);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-3xl sm:max-w-[90vw] md:max-w-[90vw] lg:max-w-3xl h-[80vh] p-0 flex flex-col overflow-scroll"
        showCloseButton
      >
        {selectedPlugin ? (
          <PluginTestsView
            plugin={selectedPlugin}
            onBack={() => setSelectedPluginName(null)}
          />
        ) : (
          <PluginListView
            plugins={plugins}
            onToggle={onToggle}
            onToggleAll={onToggleAll}
            onSelectPlugin={setSelectedPluginName}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
