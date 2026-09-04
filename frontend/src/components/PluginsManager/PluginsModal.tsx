import { useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import type { Plugin } from "@/types/plugin";
import { PluginListView } from "./PluginListView";
import { PluginTestsView } from "./PluginTestsView";

interface PluginsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  plugins: Plugin[];
  onToggle: (plugin: Plugin, nextActive: boolean) => void;
}

export function PluginsModal({
  isOpen,
  onOpenChange,
  plugins,
  onToggle,
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
        className="sm:max-w-xl p-0 overflow-hidden flex flex-col h-[80vh] max-h-150"
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
            onSelectPlugin={setSelectedPluginName}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
