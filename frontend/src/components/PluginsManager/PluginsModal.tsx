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
  hasModel?: boolean;
  onImportPlugin: (files: FileList) => void;
  onRemovePlugin: (plugin: Plugin) => void;
  onEditPlugin: (plugin: Plugin) => void;
  isImporting: boolean;
  onOpenDraft: (name: string) => void;
}

export function PluginsModal({
  isOpen,
  onOpenChange,
  plugins,
  onToggle,
  onToggleAll,
  hasModel = true,
  onImportPlugin,
  onRemovePlugin,
  onEditPlugin,
  isImporting,
  onOpenDraft,
}: PluginsModalProps) {
  const [selectedPlugins, setSelectedPlugins] = useState<Plugin[]>([]);

  function handleOpenChange(open: boolean) {
    if (!open) setSelectedPlugins([]);
    onOpenChange(open);
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-3xl sm:max-w-[90vw] md:max-w-[90vw] lg:max-w-3xl h-[80vh] p-0 flex flex-col overflow-scroll"
        showCloseButton
      >
        {selectedPlugins.length > 0 ? (
          <PluginTestsView
            plugins={selectedPlugins}
            onBack={() => setSelectedPlugins([])}
          />
        ) : (
          <PluginListView
            plugins={plugins}
            onToggle={onToggle}
            onToggleAll={onToggleAll}
            onSelectPlugins={setSelectedPlugins}
            hasModel={hasModel}
            onImportPlugin={onImportPlugin}
            onRemovePlugin={onRemovePlugin}
            onEditPlugin={onEditPlugin}
            isImporting={isImporting}
            onOpenDraft={onOpenDraft}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
