import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getPlugins, setPluginActive, importPlugin, removePlugin, editPlugin } from "@/lib/get-plugins";
import type { Plugin } from "@/types/plugin";
import { PluginsMenu } from "./PluginsMenu";
import { PluginsModal } from "./PluginsModal";
import { useDraftEditor } from "./draft-editor-context";

interface PluginsManagerProps {
  forceOpenDownward?: boolean;
}

export function PluginsManager({ forceOpenDownward }: PluginsManagerProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const { openDraft, pluginsVersion } = useDraftEditor();

  function refreshPlugins() {
    return getPlugins().then(setPlugins);
  }

  useEffect(() => {
    refreshPlugins();
  }, [pluginsVersion]);

  async function togglePlugin(plugin: Plugin, nextActive: boolean) {
    setPlugins((prev) =>
      prev.map((p) => (p.id === plugin.id ? { ...p, active: nextActive } : p)),
    );

    try {
      await setPluginActive(plugin.name, nextActive);
      toast.success(`'${plugin.name}' ${nextActive ? "activated" : "deactivated"}.`);
    } catch {
      setPlugins((prev) =>
        prev.map((p) =>
          p.id === plugin.id ? { ...p, active: plugin.active } : p,
        ),
      );
      toast.error(`Could not ${nextActive ? "activate" : "deactivate"} '${plugin.name}'.`);
    }
  }

  async function handleImportPlugin(files: FileList) {
    setIsImporting(true);
    setImportError(null);
    try {
      const result = await importPlugin(files);
      await refreshPlugins();
      toast.success(`'${result.name}' imported successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import the plugin.";
      setImportError(message);
      toast.error(message);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleRemovePlugin(plugin: Plugin) {
    try {
      await removePlugin(plugin.name);
      await refreshPlugins();
      toast.success(`'${plugin.name}' removed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not remove the plugin.";
      setImportError(message);
      toast.error(message);
    }
  }

  async function handleEditPlugin(plugin: Plugin) {
    try {
      await editPlugin(plugin.name);
      await refreshPlugins();
      setIsModalOpen(false);
      openDraft(plugin.name);
      toast.success(`'${plugin.name}' moved to drafts for editing.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start editing the plugin.";
      setImportError(message);
      toast.error(message);
    }
  }

  return (
    <>
      <PluginsMenu
        plugins={plugins}
        onToggle={togglePlugin}
        onOpenManage={() => setIsModalOpen(true)}
        forceOpenDownward={forceOpenDownward}
      />
      <PluginsModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        plugins={plugins}
        onToggle={togglePlugin}
        onImportPlugin={handleImportPlugin}
        onRemovePlugin={handleRemovePlugin}
        onEditPlugin={handleEditPlugin}
        isImporting={isImporting}
        importError={importError}
        onDismissImportError={() => setImportError(null)}
        onOpenDraft={(name) => {
          setIsModalOpen(false);
          openDraft(name);
        }}
      />
    </>
  );
}
